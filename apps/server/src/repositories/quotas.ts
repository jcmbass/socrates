import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { usageQuotas } from "../db/schema";
import type { UsageQuota, QuotaPeriod } from "@buxo/domain/usage-quota";
import { newId } from "./ids";
import { dailyPeriodKey, monthlyPeriodKey, nextDailyResetAt, nextMonthlyResetAt } from "../quota/period";

function rowToQuota(row: typeof usageQuotas.$inferSelect): UsageQuota {
  return {
    id: row.id,
    userId: row.userId,
    period: row.period,
    periodKey: row.periodKey,
    tutorMessagesUsed: row.tutorMessagesUsed,
    assessorCallsUsed: row.assessorCallsUsed,
    judgeCallsUsed: row.judgeCallsUsed,
    ingestCloudCallsUsed: row.ingestCloudCallsUsed,
    costUsdEstimate: row.costUsdEstimate,
    costUsdIncomplete: row.costUsdIncomplete,
    capTutorMessages: row.capTutorMessages,
    capCostUsd: row.capCostUsd,
    resetAt: row.resetAt,
    schemaVersion: row.schemaVersion,
  };
}

export interface QuotaCaps {
  capTutorMessages: number | null;
  capCostUsd: number | null;
}

/** I-10: unique per (userId, period, periodKey) — get-or-create is done as an upsert-on-conflict-do-nothing then re-select, so concurrent first requests never race into duplicate rows. */
export async function getOrCreateQuota(
  db: Db,
  userId: string,
  period: QuotaPeriod,
  caps: QuotaCaps,
  now: Date = new Date(),
): Promise<UsageQuota> {
  const periodKey = period === "daily" ? dailyPeriodKey(now) : monthlyPeriodKey(now);
  const resetAt = period === "daily" ? nextDailyResetAt(now) : nextMonthlyResetAt(now);

  await db
    .insert(usageQuotas)
    .values({
      id: newId(),
      userId,
      period,
      periodKey,
      tutorMessagesUsed: 0,
      assessorCallsUsed: 0,
      judgeCallsUsed: 0,
      ingestCloudCallsUsed: 0,
      costUsdEstimate: 0,
      costUsdIncomplete: false,
      capTutorMessages: caps.capTutorMessages,
      capCostUsd: caps.capCostUsd,
      resetAt,
      schemaVersion: 1,
    })
    .onConflictDoNothing({ target: [usageQuotas.userId, usageQuotas.period, usageQuotas.periodKey] });

  const [row] = await db
    .select()
    .from(usageQuotas)
    .where(and(eq(usageQuotas.userId, userId), eq(usageQuotas.period, period), eq(usageQuotas.periodKey, periodKey)))
    .limit(1);
  return rowToQuota(row);
}

/**
 * `temario_builder` (P2 FIX5, 2026-07-21 post-real-run REVIEW) has no
 * dedicated per-call counter column (unlike tutor/assessor/judge/ingest) —
 * it's a rare, per-subject one-off call, not a recurring per-message unit,
 * so a new `usage_quotas` column (and migration) wasn't worth it for what
 * the founder actually needs right now: the ability to SEE cost. Its cost
 * still accumulates into the SAME `costUsdEstimate`/`costUsdIncomplete`
 * fields every other kind uses, so it counts toward the same USD cap.
 */
export type UsageKind = "tutor" | "assessor" | "judge" | "ingest" | "temario_builder" | "guided_items";

/** Increments the counter for `kind` by 1 and adds `costUsd` (§2.5: assessor/judge calls count toward the USD cap even though they have no per-message quota of their own). When `costUsd` is null (precio del modelo desconocido), the estimate stays unchanged — null ≠ $0 — and `costUsdIncomplete` is set to true. */
export async function recordUsage(db: Db, quotaId: string, kind: UsageKind, costUsd: number | null): Promise<void> {
  const costUsdEstimate =
    costUsd !== null
      ? sql`${usageQuotas.costUsdEstimate} + ${costUsd}`
      : sql`${usageQuotas.costUsdEstimate}`;
  const costUsdIncomplete = costUsd === null ? sql`true` : sql`${usageQuotas.costUsdIncomplete}`;
  switch (kind) {
    case "tutor":
      await db
        .update(usageQuotas)
        .set({ tutorMessagesUsed: sql`${usageQuotas.tutorMessagesUsed} + 1`, costUsdEstimate, costUsdIncomplete })
        .where(eq(usageQuotas.id, quotaId));
      return;
    case "assessor":
      await db
        .update(usageQuotas)
        .set({ assessorCallsUsed: sql`${usageQuotas.assessorCallsUsed} + 1`, costUsdEstimate, costUsdIncomplete })
        .where(eq(usageQuotas.id, quotaId));
      return;
    case "judge":
      await db
        .update(usageQuotas)
        .set({ judgeCallsUsed: sql`${usageQuotas.judgeCallsUsed} + 1`, costUsdEstimate, costUsdIncomplete })
        .where(eq(usageQuotas.id, quotaId));
      return;
    case "ingest":
      await db
        .update(usageQuotas)
        .set({ ingestCloudCallsUsed: sql`${usageQuotas.ingestCloudCallsUsed} + 1`, costUsdEstimate, costUsdIncomplete })
        .where(eq(usageQuotas.id, quotaId));
      return;
    case "temario_builder":
    case "guided_items":
      // No dedicated counter column — only the cost/incomplete-flag fields move.
      // guided_items must NOT increment tutorMessagesUsed.
      await db.update(usageQuotas).set({ costUsdEstimate, costUsdIncomplete }).where(eq(usageQuotas.id, quotaId));
      return;
  }
}
