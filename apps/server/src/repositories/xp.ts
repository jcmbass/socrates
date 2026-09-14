/**
 * XP ledger repository — Fase P1.
 *
 * Every XP event is signed and traceable to an assessment (P0-7), except
 * guided-session reasons which carry item metadata instead.
 * The aggregation policy (subtract | floor | grow_only) is configurable via
 * BUXO_XP_DEMOTION_POLICY; the default is "subtract".
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { xpEvents } from "../db/schema";
import type { XpEvent, XpReason } from "@buxo/domain/xp";
import { emptyXpEvent, isGuidedXpReason } from "@buxo/domain/xp";
import { assertXpOnlyFromAssessment } from "@buxo/domain/invariants";

export type XpDemotionPolicy = "subtract" | "floor" | "grow_only";

export function readXpDemotionPolicy(raw?: string): XpDemotionPolicy {
  if (raw === "floor" || raw === "grow_only") return raw;
  return "subtract";
}

function rowToXpEvent(row: typeof xpEvents.$inferSelect): XpEvent {
  return {
    id: row.id,
    userId: row.userId,
    subjectId: row.subjectId ?? undefined,
    topicId: row.topicId ?? undefined,
    delta: row.delta,
    reason: row.reason as XpReason,
    assessmentRef: row.assessmentRef ?? null,
    createdAt: row.createdAt,
    schemaVersion: row.schemaVersion,
  };
}

export interface CreateXpEventInput {
  userId: string;
  subjectId?: string;
  topicId?: string;
  delta: number;
  reason: XpReason;
  assessmentRef?: { assessmentId: string; sessionId: string } | null;
  itemId?: string;
  itemType?: string;
  difficulty?: number;
  correct?: boolean;
  responseMs?: number;
  attempt?: 1 | 2;
}

export async function createXpEvent(db: Db, input: CreateXpEventInput): Promise<XpEvent> {
  const assessmentRef = input.assessmentRef ?? null;
  if (!isGuidedXpReason(input.reason) && !assessmentRef) {
    throw new Error("createXpEvent: assessmentRef is required for non-guided XP reasons");
  }

  const event = emptyXpEvent({
    userId: input.userId,
    subjectId: input.subjectId,
    topicId: input.topicId,
    delta: input.delta,
    reason: input.reason,
    assessmentRef,
  });
  assertXpOnlyFromAssessment(event);

  const [row] = await db
    .insert(xpEvents)
    .values({
      id: event.id,
      userId: event.userId,
      subjectId: event.subjectId ?? null,
      topicId: event.topicId ?? null,
      delta: event.delta,
      reason: event.reason,
      assessmentRef: event.assessmentRef,
      itemId: input.itemId ?? null,
      itemType: input.itemType ?? null,
      difficulty: input.difficulty ?? null,
      correct: input.correct ?? null,
      responseMs: input.responseMs ?? null,
      attempt: input.attempt ?? null,
      createdAt: event.createdAt,
      schemaVersion: 1,
    })
    .returning();
  return rowToXpEvent(row);
}

/** True if this user already received session-complete XP for the topic. */
export async function hasGuidedSessionComplete(db: Db, userId: string, topicId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: xpEvents.id })
    .from(xpEvents)
    .where(
      and(
        eq(xpEvents.userId, userId),
        eq(xpEvents.topicId, topicId),
        eq(xpEvents.reason, "guided_session_complete"),
      ),
    )
    .limit(1);
  return !!row;
}

export async function listXpEventsByUser(
  db: Db,
  userId: string,
  opts?: { subjectId?: string; topicId?: string },
): Promise<XpEvent[]> {
  const conditions = [eq(xpEvents.userId, userId)];
  if (opts?.subjectId !== undefined) conditions.push(eq(xpEvents.subjectId, opts.subjectId));
  if (opts?.topicId !== undefined) conditions.push(eq(xpEvents.topicId, opts.topicId));

  const rows = await db
    .select()
    .from(xpEvents)
    .where(and(...conditions))
    .orderBy(asc(xpEvents.createdAt));
  return rows.map(rowToXpEvent);
}

/**
 * Total XP for a user, optionally scoped to a subject. Uses the SQL
 * aggregate function `xp_total` installed by migration 0008.
 */
export async function getXpTotal(db: Db, userId: string, subjectId?: string): Promise<number> {
  const result = await db.execute<{ xp_total: number }>(
    sql`SELECT xp_total(${userId}, ${subjectId ?? null}) as xp_total`,
  );
  const rows = result.rows as Array<{ xp_total: number }>;
  const first = rows[0];
  if (!first) return 0;
  return Number(first.xp_total ?? 0);
}

/**
 * Apply the configured demotion policy to a raw signed delta and the current
 * visible total. Pure; the caller decides whether to persist.
 */
export function applyXpDemotionPolicy(
  rawDelta: number,
  currentTotal: number,
  policy: XpDemotionPolicy = "subtract",
): number {
  if (rawDelta >= 0) return rawDelta;
  if (policy === "floor") return Math.max(-currentTotal, rawDelta);
  if (policy === "grow_only") return 0;
  return rawDelta; // "subtract"
}

export interface XpTotals {
  /** Raw algebraic sum (can be negative). */
  raw: number;
  /** Sum after applying the demotion policy. */
  visible: number;
  policy: XpDemotionPolicy;
}

/**
 * Compute raw and policy-adjusted totals by replaying the ledger in order.
 * This is the source of truth for the visible total when the policy is not
 * plain subtraction.
 */
export function computeXpTotals(events: XpEvent[], policy: XpDemotionPolicy = "subtract"): XpTotals {
  let raw = 0;
  let visible = 0;
  for (const e of events) {
    raw += e.delta;
    visible += applyXpDemotionPolicy(e.delta, visible, policy);
  }
  return { raw, visible, policy };
}
