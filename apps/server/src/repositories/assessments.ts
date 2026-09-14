import { and, asc, count, eq, gt, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { assessments } from "../db/schema";
import type { Assessment } from "@buxo/domain/assessment";
import type { AssessorVerdict } from "@buxo/core/assess";
import { normalizeTopicLabel } from "@buxo/domain/mastery-engine";
import type { MasteryLevel, MasteryTier } from "@buxo/domain/mastery";
import { accrueXp, xpReasonForTierChange } from "@buxo/domain/xp";
import { assertMasteryTopicScopedToSubject } from "@buxo/domain/invariants";
import { newId, nowIso } from "./ids";
import { findMasteryState, writeMasteryState, type WriteMasteryStateInput } from "./mastery";
import { createXpEvent, type CreateXpEventInput } from "./xp";

function rowToAssessment(row: typeof assessments.$inferSelect): Assessment {
  return {
    id: row.id,
    sessionId: row.sessionId,
    exchangeId: row.exchangeId,
    subjectId: row.subjectId,
    timestamp: row.timestamp,
    demonstratedUnderstanding: row.demonstratedUnderstanding,
    explainedInOwnWords: row.explainedInOwnWords,
    guessedOrPatternMatched: row.guessedOrPatternMatched,
    recommendedBand: row.recommendedBand,
    rationale: row.rationale,
    topicKey: row.topicKey,
    assessorPromptVersion: row.assessorPromptVersion,
    assessorModelId: row.assessorModelId,
    assessorProviderId: row.assessorProviderId,
    schemaVersion: row.schemaVersion,
  };
}

export interface RecordAssessmentInput {
  sessionId: string;
  exchangeId: string;
  subjectId: string;
  verdict: AssessorVerdict;
  /**
   * RAW label straight off the assessor's structured output (B2 §3, opt-in
   * `topicLabeling` prompt field) — never pre-normalized by the caller.
   * Normalization (`normalizeTopicLabel`, @buxo/domain/mastery-engine)
   * happens HERE, at the point the `Assessment` is actually constructed
   * (B2 §3.2's "se ejecuta donde se construye el Assessment"), so every
   * caller gets the same normalized identity for free. Optional (defaults
   * to `null`, "no topic label") so a caller that doesn't opt into
   * topic-labeling (B2 §3, `apps/server/src/models/assess.ts`'s
   * `topicLabeling` builder flag) doesn't have to pass anything.
   */
  topicKeyRaw?: string | null;
  assessorPromptVersion: string;
  assessorModelId: string;
  assessorProviderId: string;
}

export async function recordAssessment(db: Db, input: RecordAssessmentInput): Promise<Assessment> {
  const [row] = await db
    .insert(assessments)
    .values({
      id: newId(),
      sessionId: input.sessionId,
      exchangeId: input.exchangeId,
      subjectId: input.subjectId,
      timestamp: nowIso(),
      demonstratedUnderstanding: input.verdict.demonstratedUnderstanding,
      explainedInOwnWords: input.verdict.explainedInOwnWords,
      guessedOrPatternMatched: input.verdict.guessedOrPatternMatched,
      recommendedBand: input.verdict.recommendedBand,
      rationale: input.verdict.rationale,
      topicKey: normalizeTopicLabel(input.topicKeyRaw ?? null),
      assessorPromptVersion: input.assessorPromptVersion,
      assessorModelId: input.assessorModelId,
      assessorProviderId: input.assessorProviderId,
      schemaVersion: 1,
    })
    .returning();
  return rowToAssessment(row);
}

export interface ListAssessmentsBySubjectOptions {
  /** Normalized topicKey to scope to — pass `""` (SUBJECT_ROLLUP_TOPIC_KEY) explicitly for rollup-only, omit for "every Assessment of this subject" (B2 §1.1's rollup scope already gets everything by default). */
  topicKey?: string;
  /** Only Assessments strictly after this ISO-8601 timestamp — mirrors B3 §8.1's `AssessmentStore.listBySubject(subjectId, { since? })`. */
  since?: string;
}

/** B2 §1.1's `AssessmentStore.listBySubject` — ordered by `timestamp` ascending (the order every reducer in `@buxo/domain/mastery-engine` assumes). */
export async function listAssessmentsBySubject(
  db: Db,
  subjectId: string,
  opts: ListAssessmentsBySubjectOptions = {},
): Promise<Assessment[]> {
  const conditions = [eq(assessments.subjectId, subjectId)];
  if (opts.topicKey !== undefined) conditions.push(eq(assessments.topicKey, opts.topicKey));
  if (opts.since !== undefined) conditions.push(gt(assessments.timestamp, opts.since));
  const rows = await db
    .select()
    .from(assessments)
    .where(and(...conditions))
    .orderBy(asc(assessments.timestamp));
  return rows.map(rowToAssessment);
}

/** Cheap group-by, B2 §3.2/§9.1 + B4 inspect endpoint's "conteos de topicKey aún no materializados" (§5.2). Excludes `null` topicKey (untagged Assessments never contribute to a per-topic count). */
export async function countAssessmentsGroupedByTopicKey(
  db: Db,
  subjectId: string,
): Promise<Array<{ topicKey: string; count: number }>> {
  const rows = await db
    .select({ topicKey: assessments.topicKey, count: count() })
    .from(assessments)
    .where(and(eq(assessments.subjectId, subjectId), isNotNull(assessments.topicKey)))
    .groupBy(assessments.topicKey);
  return rows.map((r) => ({ topicKey: r.topicKey as string, count: r.count }));
}

/**
 * Provisional mapping from a single assessor verdict to a mastery tier.
 * TODO(P1): the real aggregation engine (B2) folds history, not a one-shot
 * verdict. This helper exists only to satisfy the P1 write-path contract
 * (Assessment + Mastery + XP atomically) and will be replaced/superseded by
 * the real aggregation job in F4.
 */
function tierFromVerdict(verdict: AssessorVerdict): MasteryTier {
  if (verdict.demonstratedUnderstanding === "solid" && verdict.explainedInOwnWords && !verdict.guessedOrPatternMatched) {
    return "mastered";
  }
  if (verdict.demonstratedUnderstanding === "solid" || verdict.demonstratedUnderstanding === "developing") {
    return "consolidated";
  }
  return "developing";
}

function buildMasteryLevel(tier: MasteryTier): MasteryLevel {
  return {
    tier,
    positiveStreak: 0,
    negativeStreak: 0,
    strongCount: 0,
    recentStrongEvidence: [],
    lastPositiveAt: null,
    lastPromotionAt: null,
  };
}

export interface RecordTopicAssessmentInput {
  userId: string;
  sessionId: string;
  exchangeId: string;
  subjectId: string;
  verdict: AssessorVerdict;
  /** UUID of the `Tema` in the subject's temario that this assessment targets. */
  topicId: string;
  /** Set of topic ids that exist in the subject's temario — required to enforce P0-4. */
  allowedTopicIds: Set<string>;
  /** Visibility mode for the mastery row written by this call. */
  visibility: "shadow" | "visible";
  assessorPromptVersion: string;
  assessorModelId: string;
  assessorProviderId: string;
}

export interface RecordTopicAssessmentResult {
  assessment: Assessment;
  state: import("./mastery").WriteMasteryStateResult;
  xpEvent: import("@buxo/domain/xp").XpEvent;
}

/**
 * Record an Assessment and, in the SAME transaction, write a topic-scoped
 * MasteryState + MasteryHistoryEntry and the XP event derived from the tier
 * change. This is the P1 transactional seam the assessor flow will call once
 * F4 wires it end-to-end.
 */
export async function recordTopicAssessment(db: Db, input: RecordTopicAssessmentInput): Promise<RecordTopicAssessmentResult> {
  assertMasteryTopicScopedToSubject(
    { topicId: input.topicId } as import("@buxo/domain/mastery").MasteryHistoryEntry,
    input.allowedTopicIds,
  );

  return db.transaction(async (tx) => {
    const assessment = await recordAssessment(tx as unknown as Db, {
      sessionId: input.sessionId,
      exchangeId: input.exchangeId,
      subjectId: input.subjectId,
      verdict: input.verdict,
      topicKeyRaw: input.topicId,
      assessorPromptVersion: input.assessorPromptVersion,
      assessorModelId: input.assessorModelId,
      assessorProviderId: input.assessorProviderId,
    });

    const existing = await findMasteryState(tx as unknown as Db, input.userId, input.subjectId, input.topicId);

    const nextTier = tierFromVerdict(input.verdict);
    const prevTier = (existing?.currentLevel?.tier as MasteryTier) ?? "emerging";
    const delta = accrueXp(prevTier, nextTier);
    const reason = xpReasonForTierChange(prevTier, nextTier);

    const state = await writeMasteryState(tx as unknown as Db, {
      userId: input.userId,
      subjectId: input.subjectId,
      topicKey: input.topicId,
      topicId: input.topicId,
      level: buildMasteryLevel(nextTier),
      visibility: input.visibility,
      computedByVersion: "p1-topic-seed",
      contributingAssessmentIds: [assessment.id],
    } as WriteMasteryStateInput);

    const xpEvent = await createXpEvent(tx as unknown as Db, {
      userId: input.userId,
      subjectId: input.subjectId,
      topicId: input.topicId,
      delta,
      reason,
      assessmentRef: { assessmentId: assessment.id, sessionId: input.sessionId },
    } as CreateXpEventInput);

    return { assessment, state, xpEvent };
  });
}

