/**
 * XP — pure motor.
 *
 * As of plan-xp-progreso (2026-07-28), the **primary** XP source is evidence
 * of understanding from each Assessment (`evidenceXpFromVerdict`) — a
 * monotone count of observed facts, NOT a reflection of MasteryState.
 * Tier-change accrual (`accrueXp`) remains for historical / demotion-policy
 * callers but is no longer the live write path for the beta.
 *
 * There is no XP for navigation, opening topics, or completing milestones.
 */
import { z } from "zod";
import type { MasteryTier } from "./mastery";
import { MASTERY_TIER_ORDER } from "./mastery";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";
import { DEMONSTRATED_UNDERSTANDING_LEVELS } from "./assessment";

/** Linear default: each full tier jump is worth this many XP points. */
export const XP_PER_TIER_INCREMENT = 100;

/** Evidence XP base when `demonstratedUnderstanding === "developing"`. */
export const XP_EVIDENCE_DEVELOPING = 2;
/** Evidence XP base when `demonstratedUnderstanding === "solid"`. */
export const XP_EVIDENCE_SOLID = 3;
/** Bonus when `explainedInOwnWords` and base > 0. */
export const XP_EVIDENCE_OWN_WORDS_BONUS = 1;

/** Guided session — first attempt on an item (plan-sesion-guiada D-S06). */
export const XP_GUIDED_CORRECT = 10;
/** Guided session — correct on the single allowed retry. */
export const XP_GUIDED_RETRY = 5;
/** Guided session — completion bonus (idempotent at the server). */
export const XP_GUIDED_SESSION = 25;

export const GUIDED_XP_REASONS = [
  "guided_item_correct",
  "guided_item_retry",
  "guided_session_complete",
] as const;

export type GuidedXpReason = (typeof GUIDED_XP_REASONS)[number];

export const XP_REASONS = [
  "tier_unchanged",
  "tier_promoted",
  "tier_demoted",
  /** Evidence path (plan-xp-progreso Fase 1): developing without own-words bonus. */
  "evidence_developing",
  /** Evidence path: developing + explainedInOwnWords. */
  "evidence_developing_own_words",
  /** Evidence path: solid without own-words bonus. */
  "evidence_solid",
  /** Evidence path: solid + explainedInOwnWords. */
  "evidence_solid_own_words",
  /** Guided session: item correct on first attempt. */
  "guided_item_correct",
  /** Guided session: item correct on retry. */
  "guided_item_retry",
  /** Guided session: topic session completed. */
  "guided_session_complete",
] as const;

export type XpReason = (typeof XP_REASONS)[number];

/** Minimal verdict slice needed to score evidence XP — matches Assessment fields. */
export interface EvidenceXpVerdict {
  demonstratedUnderstanding: (typeof DEMONSTRATED_UNDERSTANDING_LEVELS)[number];
  explainedInOwnWords: boolean;
  guessedOrPatternMatched: boolean;
}

/**
 * Pure evidence→XP table (plan-xp-progreso Fase 1, decisión del arquitecto):
 *
 * | Condición                                              | XP |
 * |--------------------------------------------------------|----|
 * | guessedOrPatternMatched === true                       | 0  |
 * | demonstratedUnderstanding = none \| weak               | 0  |
 * | demonstratedUnderstanding = developing                 | +2 |
 * | demonstratedUnderstanding = solid                      | +3 |
 * | explainedInOwnWords && base > 0                        | +1 |
 *
 * Returns `null` when delta is 0 — callers must NOT write an XpEvent for a
 * no-op (same discipline as REVIEW P0 on `tier_unchanged`).
 */
export function evidenceXpFromVerdict(verdict: EvidenceXpVerdict): { delta: number; reason: XpReason } | null {
  if (verdict.guessedOrPatternMatched) return null;
  if (verdict.demonstratedUnderstanding === "none" || verdict.demonstratedUnderstanding === "weak") {
    return null;
  }

  const base =
    verdict.demonstratedUnderstanding === "solid" ? XP_EVIDENCE_SOLID : XP_EVIDENCE_DEVELOPING;
  const ownWords = verdict.explainedInOwnWords === true;
  const delta = base + (ownWords ? XP_EVIDENCE_OWN_WORDS_BONUS : 0);

  let reason: XpReason;
  if (verdict.demonstratedUnderstanding === "solid") {
    reason = ownWords ? "evidence_solid_own_words" : "evidence_solid";
  } else {
    reason = ownWords ? "evidence_developing_own_words" : "evidence_developing";
  }

  return { delta, reason };
}

/** XP delta + reason for a guided item answer (`attempt` 1 = first try, 2 = retry). */
export function guidedItemXp(attempt: 1 | 2): { delta: number; reason: XpReason } {
  if (attempt === 1) {
    return { delta: XP_GUIDED_CORRECT, reason: "guided_item_correct" };
  }
  return { delta: XP_GUIDED_RETRY, reason: "guided_item_retry" };
}

/** XP delta + reason for completing a guided session on a topic. */
export function guidedSessionXp(): { delta: number; reason: XpReason } {
  return { delta: XP_GUIDED_SESSION, reason: "guided_session_complete" };
}

export function isGuidedXpReason(reason: XpReason): reason is GuidedXpReason {
  return (GUIDED_XP_REASONS as readonly string[]).includes(reason);
}

/** Reference to the Assessment that produced an XP event. */
export interface AssessmentRef {
  assessmentId: string;
  sessionId: string;
}

export const AssessmentRefSchema: z.ZodType<AssessmentRef> = z.object({
  assessmentId: idSchema,
  sessionId: idSchema,
});

export interface XpEvent {
  id: string;
  userId: string;
  subjectId?: string;
  topicId?: string;
  /** Signed delta: positive on promotion, negative on demotion, zero on no change. */
  delta: number;
  /** Reason key without numbers, in the style of gamification movement reasons. */
  reason: XpReason;
  /** The assessment that justified the delta; null for guided-session XP. */
  assessmentRef: AssessmentRef | null;
  createdAt: string;
  schemaVersion: number;
}

export const XpEventSchema: z.ZodType<XpEvent> = z
  .object({
    id: idSchema,
    userId: idSchema,
    subjectId: idSchema.optional(),
    topicId: idSchema.optional(),
    delta: z.number().int(),
    reason: z.enum(XP_REASONS),
    assessmentRef: AssessmentRefSchema.nullable(),
    createdAt: isoTimestampSchema,
    schemaVersion: schemaVersionSchema,
  })
  .superRefine((event, ctx) => {
    if (isGuidedXpReason(event.reason)) {
      if (event.assessmentRef !== null) {
        ctx.addIssue({
          code: "custom",
          message: "Guided XpEvent must not reference an assessment",
          path: ["assessmentRef"],
        });
      }
      return;
    }
    if (event.assessmentRef === null) {
      ctx.addIssue({
        code: "custom",
        message: "XpEvent must reference an assessment",
        path: ["assessmentRef"],
      });
    }
  });

/** Ledger = ordered history of XP events for a user (optionally scoped). */
export type XpLedger = XpEvent[];

/**
 * Deterministic, pure XP accrual from a mastery tier change.
 * Returns a signed integer: positive for promotion, negative for demotion,
 * zero when the tier did not change.
 */
export function accrueXp(prevTier: MasteryTier, nextTier: MasteryTier): number {
  const prevOrder = MASTERY_TIER_ORDER[prevTier];
  const nextOrder = MASTERY_TIER_ORDER[nextTier];
  return (nextOrder - prevOrder) * XP_PER_TIER_INCREMENT;
}

/** Choose a reason key for the tier change. */
export function xpReasonForTierChange(prevTier: MasteryTier, nextTier: MasteryTier): XpReason {
  const comparison = prevTier === nextTier ? 0 : MASTERY_TIER_ORDER[nextTier] - MASTERY_TIER_ORDER[prevTier];
  if (comparison > 0) return "tier_promoted";
  if (comparison < 0) return "tier_demoted";
  return "tier_unchanged";
}

export function newXpEventId(now: Date = new Date()): string {
  const compact = now.toISOString().replace(/[-:]/g, "").replace(/\./g, "");
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${compact}-x${suffix}`;
}

export function emptyXpEvent(input: {
  id?: string;
  userId: string;
  subjectId?: string;
  topicId?: string;
  delta: number;
  reason: XpReason;
  assessmentRef?: AssessmentRef | null;
  now?: Date;
}): XpEvent {
  const now = input.now ?? new Date();
  return {
    id: input.id ?? newXpEventId(now),
    userId: input.userId,
    subjectId: input.subjectId,
    topicId: input.topicId,
    delta: input.delta,
    reason: input.reason,
    assessmentRef: input.assessmentRef ?? null,
    createdAt: now.toISOString(),
    schemaVersion: 1,
  };
}

export function serializeXpEvent(event: XpEvent): string {
  return JSON.stringify(event, null, 2);
}

export function parseXpEvent(value: unknown): XpEvent {
  return XpEventSchema.parse(value);
}

export function deserializeXpEvent(json: string): XpEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("XpEvent JSON is not valid");
  }
  return parseXpEvent(parsed);
}
