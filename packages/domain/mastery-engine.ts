/**
 * Motor de dominio — B2-motor-de-dominio.md §1-§3. Pure reducer functions
 * over the `Assessment` stream (@buxo/domain/assessment), same purity
 * contract as `applyAssessment` in `packages/core/assess.ts` (no I/O, no
 * `Date.now()`/randomness — `now`/timestamps are always caller-supplied):
 * band control is a per-exchange, single-session concern; THIS module is
 * the cross-session/cross-time equivalent for *domain*, deliberately more
 * conservative (B2 §0 point 3 — "el dominio nunca sube por una sola buena
 * explicación").
 *
 * Scope (architect's explicit ruling, F2 WQ3 parte A1): only the five
 * B2 §1/§3 functions actually requested — `classifySignal`, `aggregate`,
 * `applyDecay`, `normalizeTopicLabel`, `foldMasteryLevel` — plus the
 * versioned config they share. `updateStreak` (§1.7), `maybeAwardAchievements`
 * (§4.2), `explainChallengeGap` (§4.5), `explainMovement` (§9.2) and
 * `ChallengeCriteria` (§4.1) are F3 — NOT implemented or stubbed here.
 * `maybeMaterializeTopic` (§3.2) and `recomputeMasteryState` (§6.2) are
 * thin C2-side callers of `foldMasteryLevel`, not domain-package exports.
 */
import type { Assessment } from "./assessment";
import { MASTERY_TIERS, type MasteryEvidenceRef, type MasteryLevel, type MasteryTier } from "./mastery";

// ---------------------------------------------------------------------------
// Versioned configuration (B2 §2, §3.3: "un retune de umbral ... es un
// cambio de versión, no un ajuste silencioso"). Every threshold this module
// consults lives here — none hardcoded loose in the function bodies below.
// ---------------------------------------------------------------------------

/** Identifies THIS reducer + these thresholds as one unit (MasteryHistoryEntry.computedByVersion, B3 §3). */
export const B2_AGGREGATION_VERSION = "b2-agg-1";

export interface MasteryPromotionConfig {
  /** emerging -> developing: N `positive`/`strongPositive` signals in a row (B2 §1.3). */
  developingPositiveStreak: number;
  /** developing -> consolidated: N `strongPositive`, in >= M distinct sessions. */
  consolidatedStrongCount: number;
  consolidatedMinDistinctSessions: number;
  /** consolidated -> mastered: N more `strongPositive`, in >= M distinct sessions, >= D days after the last promotion. */
  masteredStrongCount: number;
  masteredMinDistinctSessions: number;
  masteredMinDaysSinceLastPromotion: number;
}

export interface MasteryDemotionConfig {
  /** Consecutive `negative` signals required to step a tier down (B2 §1.4 — "no whiplash"). */
  negativeStreakThreshold: number;
}

/** B2 §1.5 — days since `lastPositiveAt` before a tier decays one step. `emerging` never decays (not a key here). */
export type MasteryStalenessDaysConfig = Record<Exclude<MasteryTier, "emerging">, number>;

export interface MasteryAggregationConfig {
  version: string;
  promotion: MasteryPromotionConfig;
  demotion: MasteryDemotionConfig;
  /** Cap on `MasteryLevel.recentStrongEvidence` (B2 §1.3 `push_capped`). */
  recentStrongEvidenceCap: number;
  stalenessDays: MasteryStalenessDaysConfig;
  /** B2 §3.2 — times a normalized `topicKey` must recur before a per-topic `MasteryState` materializes. Consumed by the (out-of-scope, C2-side) `maybeMaterializeTopic`; kept here because it's the same versioned-threshold unit. */
  topicMaterializationThreshold: number;
}

/** B2 §2's table + §1.4/§1.5's numbers, all of them explicitly "puntos de partida razonados ... no calibrados con datos reales" (B2 §10 P-5) — sitting behind `B2_AGGREGATION_VERSION` so a retune bumps the version, never a silent edit. */
export const DEFAULT_MASTERY_AGGREGATION_CONFIG: MasteryAggregationConfig = {
  version: B2_AGGREGATION_VERSION,
  promotion: {
    developingPositiveStreak: 3,
    consolidatedStrongCount: 3,
    consolidatedMinDistinctSessions: 2,
    masteredStrongCount: 2,
    masteredMinDistinctSessions: 1,
    masteredMinDaysSinceLastPromotion: 3,
  },
  demotion: {
    negativeStreakThreshold: 2,
  },
  recentStrongEvidenceCap: 6,
  stalenessDays: {
    developing: 45,
    consolidated: 60,
    mastered: 90,
  },
  topicMaterializationThreshold: 3,
};

// ---------------------------------------------------------------------------
// Tier order helpers (B2 §1.4: emerging(0) < developing(1) < consolidated(2)
// < mastered(3), floor at emerging). `MASTERY_TIERS` (mastery.ts) is already
// declared in this exact order — reused rather than re-declared.
// ---------------------------------------------------------------------------

function tierIndex(tier: MasteryTier): number {
  return MASTERY_TIERS.indexOf(tier);
}

/** One escalón down, floored at "emerging" (index 0) — never below it once a `MasteryState` row exists (B2 §1.4). */
function stepDown(tier: MasteryTier): MasteryTier {
  return MASTERY_TIERS[Math.max(0, tierIndex(tier) - 1)];
}

/** Elapsed real time in days between two ISO-8601 timestamps (B3 §1 convention) — not a calendar-day count. */
function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / (24 * 60 * 60 * 1000);
}

function countDistinctSessions(evidence: readonly MasteryEvidenceRef[]): number {
  return new Set(evidence.map((e) => e.sessionId)).size;
}

/** `push_capped` (B2 §1.3) — appends, then keeps only the CAP most recent entries. Never mutates `arr`. */
function pushCapped<T>(arr: readonly T[], item: T, cap: number): T[] {
  const next = [...arr, item];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// ---------------------------------------------------------------------------
// classifySignal — B2 §1.2
// ---------------------------------------------------------------------------

export type MasterySignal = "strongPositive" | "positive" | "negative";

/**
 * B2 §1.2. Deliberate note preserved from the spec: `explainedInOwnWords ===
 * false` classifies `negative` even when `demonstratedUnderstanding` is
 * "solid" — declaring understanding is never enough, only demonstrating it
 * is. `guessedOrPatternMatched === true` is likewise always `negative`,
 * regardless of how high `demonstratedUnderstanding` reads.
 */
export function classifySignal(
  a: Pick<Assessment, "demonstratedUnderstanding" | "explainedInOwnWords" | "guessedOrPatternMatched">,
): MasterySignal {
  const isPositive =
    (a.demonstratedUnderstanding === "developing" || a.demonstratedUnderstanding === "solid") &&
    a.explainedInOwnWords === true &&
    a.guessedOrPatternMatched === false;

  if (!isPositive) return "negative";
  return a.demonstratedUnderstanding === "solid" ? "strongPositive" : "positive";
}

// ---------------------------------------------------------------------------
// aggregate — B2 §1.3-§1.4 (the reductor)
// ---------------------------------------------------------------------------

function emergingLevel(): MasteryLevel {
  return {
    tier: "emerging",
    positiveStreak: 0,
    negativeStreak: 0,
    strongCount: 0,
    recentStrongEvidence: [],
    lastPositiveAt: null,
    lastPromotionAt: null,
  };
}

/**
 * B2 §1.3-§1.4. Pure: never mutates `prev`, always returns a NEW
 * `MasteryLevel`. `prev === null` materializes the row directly at
 * "emerging" (the floor, not "no evidence" — that's the absence of a row,
 * B2 §2). At most one tier step — promotion OR demotion — per `Assessment`
 * processed, same "no whiplash" clamp discipline as `applyAssessment`
 * (packages/core/assess.ts), applied here to the *mastery* axis instead of
 * the *scaffolding-band* axis.
 */
export function aggregate(
  prev: MasteryLevel | null,
  a: Assessment,
  config: MasteryAggregationConfig = DEFAULT_MASTERY_AGGREGATION_CONFIG,
): MasteryLevel {
  const level: MasteryLevel = prev
    ? { ...prev, recentStrongEvidence: [...prev.recentStrongEvidence] }
    : emergingLevel();

  const signal = classifySignal(a);

  if (signal === "negative") {
    level.negativeStreak += 1;
    level.positiveStreak = 0;
    if (level.negativeStreak >= config.demotion.negativeStreakThreshold && level.tier !== "emerging") {
      level.tier = stepDown(level.tier);
      level.negativeStreak = 0;
      level.strongCount = 0;
      level.recentStrongEvidence = [];
    }
    return level;
  }

  // signal is "positive" or "strongPositive" from here on.
  level.positiveStreak += 1;
  level.negativeStreak = 0;
  level.lastPositiveAt = a.timestamp;

  if (signal === "strongPositive") {
    level.strongCount += 1;
    level.recentStrongEvidence = pushCapped(
      level.recentStrongEvidence,
      { assessmentId: a.id, sessionId: a.sessionId, timestamp: a.timestamp },
      config.recentStrongEvidenceCap,
    );
  }

  const distinctSessions = countDistinctSessions(level.recentStrongEvidence);

  if (level.tier === "emerging" && level.positiveStreak >= config.promotion.developingPositiveStreak) {
    level.tier = "developing";
    level.strongCount = 0;
    level.recentStrongEvidence = [];
  } else if (
    level.tier === "developing" &&
    level.strongCount >= config.promotion.consolidatedStrongCount &&
    distinctSessions >= config.promotion.consolidatedMinDistinctSessions
  ) {
    level.tier = "consolidated";
    level.lastPromotionAt = a.timestamp;
    level.strongCount = 0;
    level.recentStrongEvidence = [];
  } else if (
    level.tier === "consolidated" &&
    level.strongCount >= config.promotion.masteredStrongCount &&
    distinctSessions >= config.promotion.masteredMinDistinctSessions &&
    level.lastPromotionAt !== null &&
    daysBetween(level.lastPromotionAt, a.timestamp) >= config.promotion.masteredMinDaysSinceLastPromotion
  ) {
    level.tier = "mastered";
    level.lastPromotionAt = a.timestamp;
    // No reset of strongCount/recentStrongEvidence here (B2 §1.3, deliberate):
    // "mastered" has no tier above it — the counters keep accumulating as a
    // "sustained mastery" trail but no longer gate any further promotion.
  }

  return level;
}

// ---------------------------------------------------------------------------
// applyDecay — B2 §1.5
// ---------------------------------------------------------------------------

/**
 * B2 §1.5. NOT part of the per-Assessment reducer — a periodic job's
 * concern (backfill-job pattern, B3 §5.1). Returns `null` when nothing
 * changes (no `MasteryHistoryEntry` is written for a no-op decay check).
 * "emerging" never decays — it's already the floor.
 */
export function applyDecay(
  level: MasteryLevel,
  now: string,
  config: MasteryAggregationConfig = DEFAULT_MASTERY_AGGREGATION_CONFIG,
): MasteryLevel | null {
  if (level.tier === "emerging") return null;

  const staleDays = config.stalenessDays[level.tier];
  const isStale = level.lastPositiveAt === null || daysBetween(level.lastPositiveAt, now) > staleDays;
  if (!isStale) return null;

  return {
    ...level,
    tier: stepDown(level.tier),
    strongCount: 0,
    recentStrongEvidence: [],
  };
}

// ---------------------------------------------------------------------------
// normalizeTopicLabel — B2 §3.2
// ---------------------------------------------------------------------------

const TOPIC_LABEL_MAX_LENGTH = 48;
/** Unicode combining-diacritical-marks block (U+0300-U+036F) — what NFKD decomposition splits accented characters into (e.g. "ó" -> "o" + U+0301). */
const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;
const NON_ALNUM_RUN_PATTERN = /[^a-z0-9]+/g;
const EDGE_DASHES_PATTERN = /^-+|-+$/g;

/**
 * B2 §3.2. `null` in -> `null` out; `""`/whitespace-only -> `null`.
 * Deliberately does NOT resolve semantic synonyms ("derivacion" vs
 * "regla-de-la-cadena") — collision reduction only (B2 §3.2's own caveat).
 */
export function normalizeTopicLabel(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const withoutDiacritics = trimmed.normalize("NFKD").replace(COMBINING_MARKS_PATTERN, "");
  const dashed = withoutDiacritics
    .toLowerCase()
    .replace(NON_ALNUM_RUN_PATTERN, "-")
    .replace(EDGE_DASHES_PATTERN, "");
  const truncated = dashed.slice(0, TOPIC_LABEL_MAX_LENGTH).replace(EDGE_DASHES_PATTERN, "");

  return truncated === "" ? null : truncated;
}

// ---------------------------------------------------------------------------
// foldMasteryLevel — B2 §6.2 / §3.2's shared replay primitive
// ---------------------------------------------------------------------------

export interface FoldMasteryLevelOptions {
  /** B2 §6.2 `recomputeMasteryState`'s `opts.excludeAssessmentIds` — evidence to drop from the replay (e.g. a confirmed-miscalibrated assessor tripleta, or contaminated evidence behind a revoked Achievement). */
  excludeAssessmentIds?: string[];
}

/**
 * B2 §6.2's `fold(aggregate, null, history)`, generalized into the one
 * reusable primitive both `maybeMaterializeTopic` (§3.2, a topic's
 * `MasteryState` is born by replaying its own already-seen `Assessment`s)
 * and `recomputeMasteryState` (§6.2, a directed recompute excluding bad
 * evidence) are thin C2-side wrappers around — neither wrapper lives in
 * this domain package (out of scope, see module doc).
 *
 * `assessments` need not arrive pre-sorted — sorted defensively by
 * `timestamp` here (the caller is expected to already guarantee order per
 * B2 §1.3, this is a belt-and-suspenders assert-by-construction, not a
 * trust boundary this module relies on).
 */
export function foldMasteryLevel(
  assessments: readonly Assessment[],
  opts: FoldMasteryLevelOptions = {},
  config: MasteryAggregationConfig = DEFAULT_MASTERY_AGGREGATION_CONFIG,
): MasteryLevel | null {
  const excluded = new Set(opts.excludeAssessmentIds ?? []);
  const ordered = assessments
    .filter((a) => !excluded.has(a.id))
    .slice()
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  let level: MasteryLevel | null = null;
  for (const a of ordered) {
    level = aggregate(level, a, config);
  }
  return level;
}
