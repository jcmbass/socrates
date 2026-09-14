/**
 * Motor de gamificación — B2-motor-de-dominio.md §1.7, §4, §6.3, §9.2.
 *
 * Pure functions for the anti-farming economy (O-7): streak tracking,
 * challenge/achievement awarding, and user-facing reason keys for A5/A6.
 * Zero I/O, zero model calls — same purity contract as `mastery-engine.ts`.
 *
 * **Allowlist expectation (B2 §7.2):** The caller (C2/server-side, G2) is
 * responsible for filtering out `Assessment`s produced by a non-approved
 * assessor tripleta BEFORE invoking `updateStreak` or
 * `maybeAwardAchievements`. This module is pure and has no knowledge of
 * allowlists — it trusts that every `Assessment` it receives has already
 * passed the gate. See B2 §7.2 for the full tripleta-filtering policy.
 *
 * **Retry without reduced bar (B2 §6.3):** When a revoked Achievement is
 * re-earned, the criteria are EXACTLY the same `ChallengeCriteria` — no
 * discount, no reduced threshold. This module exposes the pure check
 * (`maybeAwardAchievements`); the caller (C2) orchestrates the `retryOf`
 * linkage by passing the same `ChallengeDefinition` and checking for a
 * prior revoked `Achievement` for that `(userId, challengeDefinitionId,
 * scope)` pair.
 */
import type { Assessment } from "./assessment";
import type { ChallengeCriteria, ChallengeDefinition, Streak } from "./gamification";
import type { MasteryLevel, MasteryTier } from "./mastery";
import { compareMasteryTier } from "./mastery";

// ---------------------------------------------------------------------------
// Versioned configuration (B2 §2 discipline: "un retune de umbral ... es un
// cambio de versión, no un ajuste silencioso")
// ---------------------------------------------------------------------------

/** Identifies THIS module's rules + thresholds as one versioned unit. */
export const B2_GAMIFICATION_VERSION = "b2-gam-1";

export interface GamificationConfig {
  version: string;
  /** Presets for ChallengeCriteria by tier (B2 §4.1 table). */
  challengePresets: {
    developing: ChallengeCriteria;
    consolidated: ChallengeCriteria;
    mastered: ChallengeCriteria;
  };
}

/** B2 §4.1 presets — "puntos de partida razonados ... no calibrados con datos reales" (B2 §10 P-5). */
export const DEFAULT_GAMIFICATION_CONFIG: GamificationConfig = {
  version: B2_GAMIFICATION_VERSION,
  challengePresets: {
    developing: {
      requiredTier: "developing",
      minDistinctSessions: 1,
      minDistinctCalendarDays: 1,
    },
    consolidated: {
      requiredTier: "consolidated",
      minDistinctSessions: 2,
      minDistinctCalendarDays: 2,
    },
    mastered: {
      requiredTier: "mastered",
      minDistinctSessions: 2,
      minDistinctCalendarDays: 3,
    },
  },
};

// ---------------------------------------------------------------------------
// UserFacingReasonKey — B2 §9.2 / §4.5
// ---------------------------------------------------------------------------

/**
 * Keys for i18n-localized user-facing reasons (D1 localizes the final text).
 * NEVER expose raw mechanics (counts, thresholds) — only these opaque keys.
 */
export const USER_FACING_REASON_KEYS = [
  "EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS",
  "SUSTAINED_OVER_TIME",
  "NEEDS_MORE_PRACTICE",
  "PAUSE_TOO_LONG",
  "NEEDS_MORE_SESSIONS",
  "NEEDS_MORE_DAYS",
  "NEEDS_HIGHER_TIER",
] as const;

export type UserFacingReasonKey = (typeof USER_FACING_REASON_KEYS)[number];

// ---------------------------------------------------------------------------
// updateStreak — B2 §1.7
// ---------------------------------------------------------------------------

/**
 * B2 §1.7. Pure: never mutates `prev`, always returns a NEW `Streak`.
 *
 * `qualifies` is MORE PERMISSIVE than `classifySignal`'s "positive" (B2 §1.2):
 * "weak" honest understanding DOES count here (encourages engagement, not
 * silence), but a guess NEVER counts, regardless of how high
 * `demonstratedUnderstanding` reads.
 *
 * **Racha de assessments aprobados, NO de días.** Each increment represents
 * one qualifying assessment, not a calendar day of activity.
 */
export function updateStreak(prev: Streak, a: Assessment): Streak {
  const qualifies =
    a.explainedInOwnWords === true &&
    a.guessedOrPatternMatched === false &&
    a.demonstratedUnderstanding !== "none";

  if (qualifies) {
    const current = prev.current + 1;
    const longest = Math.max(prev.longest, current);
    return {
      ...prev,
      current,
      longest,
      lastQualifyingAssessmentId: a.id,
      lastQualifyingAt: a.timestamp,
    };
  }

  // Does NOT qualify: current resets to 0, longest never decreases.
  return {
    ...prev,
    current: 0,
    // lastQualifyingAssessmentId / lastQualifyingAt stay as they were — they
    // record the LAST qualifying event, not the current streak state.
  };
}

// ---------------------------------------------------------------------------
// maybeAwardAchievements — B2 §4.2-§4.3
// ---------------------------------------------------------------------------

/** Data needed to create a new Achievement row (caller generates id/timestamps). */
export interface NewAchievementData {
  challengeDefinitionId: string;
  challengeDefinitionVersion: string;
  subjectId: string;
  topicKey: string | null;
  evidenceAssessmentIds: string[];
  retryOf: string | null;
}

/**
 * B2 §4.2-§4.3. Idempotent: if an `Achievement` with `status: "earned"`
 * already exists for `(userId, challengeDefinitionId, scope)`, this
 * challenge is NOT re-awarded — reaching the same tier again, or surpassing
 * it, does NOT duplicate the same logro. Surpassing to a higher tier IS a
 * distinct challenge (its own `ChallengeDefinition`, its own award).
 *
 * `scope.kind: "generic"` is outside the tier-driven flow (B2 §4.1: "una
 * lista corta enumerada por B2, fuera del flujo tier-driven") — this
 * function does not evaluate generic-scope definitions.
 *
 * **`retryOf` is caller-owned (C2/G2).** This function always returns
 * `retryOf: null` in each `NewAchievementData`. The caller resolves the I-11
 * retry linkage at persist time by looking up the prior revoked `Achievement`
 * for `(userId, challengeDefinitionId, scope)` and setting `retryOf` to that
 * revoked Achievement's `id`. See B2 §6.3: the criteria for a retry are
 * EXACTLY the same `ChallengeCriteria` — no discount, no reduced threshold.
 *
 * @param userId - The user being evaluated.
 * @param subjectId - The subject context.
 * @param topicKeyOrNull - The topic context (null for subject-level rollup).
 * @param newLevel - The `MasteryLevel` produced by the most recent `aggregate` call.
 * @param existingEarned - All `Achievement` rows for this `(userId, subjectId)`
 *   — used for idempotency checks. Only `challengeDefinitionId` and `status`
 *   are consulted; `retryOf` is caller-owned and not read here.
 * @param activeDefinitions - All active `ChallengeDefinition` rows whose
 *   `scope` matches this `(subjectId, topicKeyOrNull)`.
 * @returns Array of `NewAchievementData` — one entry per newly-earned
 *   challenge. Empty array when nothing new is earned.
 */
export function maybeAwardAchievements(
  userId: string,
  subjectId: string,
  topicKeyOrNull: string | null,
  newLevel: MasteryLevel,
  existingEarned: readonly { challengeDefinitionId: string; status: string }[],
  activeDefinitions: readonly ChallengeDefinition[],
): NewAchievementData[] {
  const earned: NewAchievementData[] = [];

  for (const def of activeDefinitions) {
    // Skip generic-scope definitions — they are outside the tier-driven flow
    // (B2 §4.1: "una lista corta enumerada por B2, fuera del flujo tier-driven").
    if (def.scope.kind === "generic") continue;

    // Parse criteria — skip definitions with unparseable criteria.
    const criteria = def.criteria as ChallengeCriteria | null | undefined;
    if (!criteria || typeof criteria.requiredTier !== "string") continue;

    // Check tier threshold.
    if (compareMasteryTier(newLevel.tier, criteria.requiredTier) < 0) continue;

    // Idempotency: skip if already earned for this (userId, challengeDefinitionId, scope).
    const alreadyEarned = existingEarned.some(
      (a) =>
        a.challengeDefinitionId === def.id &&
        a.status === "earned",
    );
    if (alreadyEarned) continue;

    // Novelty check: distinct sessions and calendar days from recentStrongEvidence.
    const sessions = new Set(newLevel.recentStrongEvidence.map((e) => e.sessionId));
    const days = new Set(
      newLevel.recentStrongEvidence.map((e) => e.timestamp.slice(0, 10)),
    );

    if (sessions.size < criteria.minDistinctSessions) continue;
    if (days.size < criteria.minDistinctCalendarDays) continue;

    // `retryOf` is caller-owned — always null here. C2/G2 resolves the I-11
    // linkage at persist time by looking up the prior revoked Achievement.
    earned.push({
      challengeDefinitionId: def.id,
      challengeDefinitionVersion: def.version,
      subjectId,
      topicKey: topicKeyOrNull,
      evidenceAssessmentIds: newLevel.recentStrongEvidence.map((e) => e.assessmentId),
      retryOf: null,
    });
  }

  return earned;
}

// ---------------------------------------------------------------------------
// explainMovement — B2 §9.2
// ---------------------------------------------------------------------------

/**
 * B2 §9.2. Produces user-facing reason keys for a tier movement (promotion,
 * demotion, or decay). NEVER exposes raw mechanics (counts, thresholds) —
 * only opaque i18n keys.
 *
 * @param prevTier - The tier before the movement.
 * @param newTier - The tier after the movement.
 * @param contributingAssessments - The assessments that contributed to this
 *   movement (used to determine if evidence spans multiple sessions).
 * @returns Array of `UserFacingReasonKey` — empty when there is no movement
 *   (tier unchanged).
 */
export function explainMovement(
  prevTier: MasteryTier,
  newTier: MasteryTier,
  contributingAssessments: readonly Pick<Assessment, "sessionId" | "timestamp">[],
): UserFacingReasonKey[] {
  const cmp = compareMasteryTier(newTier, prevTier);

  if (cmp > 0) {
    // Promotion.
    const keys: UserFacingReasonKey[] = ["EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS"];
    if (newTier === "mastered") {
      keys.push("SUSTAINED_OVER_TIME");
    }
    return keys;
  }

  if (cmp < 0) {
    // Demotion or decay. A decay event has no contributing assessments
    // (B2 §1.5: contributingAssessmentIds is an empty array for decay).
    if (contributingAssessments.length === 0) {
      return ["PAUSE_TOO_LONG"];
    }
    return ["NEEDS_MORE_PRACTICE"];
  }

  // No movement.
  return [];
}

// ---------------------------------------------------------------------------
// explainChallengeGap — B2 §4.5
// ---------------------------------------------------------------------------

/**
 * B2 §4.5. Explains why a challenge has NOT been earned yet, using opaque
 * reason keys. NEVER exposes exact numbers ("te faltan 2 sesiones") — only
 * the category of gap.
 *
 * @param criteria - The `ChallengeCriteria` for the challenge being checked.
 * @param currentLevel - The user's current `MasteryLevel` for this scope.
 * @returns Array of `UserFacingReasonKey` — empty when the challenge IS
 *   achievable (all criteria met), non-empty with the blocking reasons.
 */
export function explainChallengeGap(
  criteria: ChallengeCriteria,
  currentLevel: MasteryLevel,
): UserFacingReasonKey[] {
  const keys: UserFacingReasonKey[] = [];

  // Tier check first — if the tier is too low, that's the primary blocker.
  if (compareMasteryTier(currentLevel.tier, criteria.requiredTier) < 0) {
    keys.push("NEEDS_HIGHER_TIER");
    // Don't add session/day gaps if the tier itself is insufficient — those
    // are moot until the tier is high enough.
    return keys;
  }

  const sessions = new Set(currentLevel.recentStrongEvidence.map((e) => e.sessionId));
  const days = new Set(
    currentLevel.recentStrongEvidence.map((e) => e.timestamp.slice(0, 10)),
  );

  if (sessions.size < criteria.minDistinctSessions) {
    keys.push("NEEDS_MORE_SESSIONS");
  }
  if (days.size < criteria.minDistinctCalendarDays) {
    keys.push("NEEDS_MORE_DAYS");
  }

  return keys;
}
