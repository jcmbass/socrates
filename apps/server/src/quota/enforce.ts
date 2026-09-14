/**
 * Quota enforcement — C-backend §2.5. `accountKind: "internal_dev"` is
 * exempt (caps `null`, B3 §2.1 already models this — "ya modelado").
 */
import type { Db } from "../db/client";
import type { AccountKind } from "@buxo/domain/user";
import { getOrCreateQuota, recordUsage, type UsageKind } from "../repositories/quotas";
import type { UsageQuota } from "@buxo/domain/usage-quota";

export interface QuotaConfig {
  dailyTutorMessages: number;
  monthlyTutorMessages: number;
  capCostUsd: number;
  /**
   * F2 WQ1 (§2.5-style ingest quota, plan-mandated "Ingest quota
   * enforcement"): no dedicated DB column stores these as a per-user
   * override (unlike `capTutorMessages`/`capCostUsd`) — they're compared
   * directly against the SAME `usage_quotas` row's `ingestCloudCallsUsed`
   * column (already existed, WP5) using this in-memory config value. See
   * `../raster/limits.ts`'s docblock for the "flag for architect review"
   * pattern this follows.
   */
  dailyIngestCloudPages: number;
  monthlyIngestCloudPages: number;
}

export interface QuotaCheck {
  daily: UsageQuota;
  monthly: UsageQuota;
}

export type QuotaCheckResult =
  | { ok: true; quotas: QuotaCheck }
  | { ok: false; reason: "daily_messages" | "monthly_messages" | "cost_cap" };

function capsFor(accountKind: AccountKind, config: QuotaConfig, period: "daily" | "monthly") {
  if (accountKind === "internal_dev") return { capTutorMessages: null, capCostUsd: null };
  return {
    capTutorMessages: period === "daily" ? config.dailyTutorMessages : config.monthlyTutorMessages,
    capCostUsd: config.capCostUsd,
  };
}

/** Loads (or creates) both quota rows and checks them against their caps — hard cutoff at 100%, per §2.5. */
export async function checkTutorQuota(
  db: Db,
  userId: string,
  accountKind: AccountKind,
  config: QuotaConfig,
  now: Date = new Date(),
): Promise<QuotaCheckResult> {
  const daily = await getOrCreateQuota(db, userId, "daily", capsFor(accountKind, config, "daily"), now);
  const monthly = await getOrCreateQuota(db, userId, "monthly", capsFor(accountKind, config, "monthly"), now);

  if (daily.capTutorMessages !== null && daily.tutorMessagesUsed >= daily.capTutorMessages) {
    return { ok: false, reason: "daily_messages" };
  }
  if (monthly.capTutorMessages !== null && monthly.tutorMessagesUsed >= monthly.capTutorMessages) {
    return { ok: false, reason: "monthly_messages" };
  }
  // PB2: costUsdEstimate null = costo no medible — tratamos como 0 para el cap (no podemos
  // asumir que excede el límite solo porque no sabemos el costo exacto).
  const dailyCost = daily.costUsdEstimate ?? 0;
  const monthlyCost = monthly.costUsdEstimate ?? 0;
  if (daily.capCostUsd !== null && dailyCost >= daily.capCostUsd) {
    return { ok: false, reason: "cost_cap" };
  }
  if (monthly.capCostUsd !== null && monthlyCost >= monthly.capCostUsd) {
    return { ok: false, reason: "cost_cap" };
  }

  return { ok: true, quotas: { daily, monthly } };
}

/** Records usage against BOTH the daily and monthly rows — every call (tutor/assessor/judge) counts toward both windows. */
export async function recordQuotaUsage(db: Db, quotas: QuotaCheck, kind: UsageKind, costUsd: number | null): Promise<void> {
  await Promise.all([recordUsage(db, quotas.daily.id, kind, costUsd), recordUsage(db, quotas.monthly.id, kind, costUsd)]);
}

export class GuidedItemsQuotaExceededError extends Error {
  readonly reason = "cost_cap" as const;
  constructor() {
    super("guided_items_quota_exceeded");
    this.name = "GuidedItemsQuotaExceededError";
  }
}

/**
 * Pre-flight for guided-items generation. Checks the USD cap only — this
 * surface must not consume or pretend to be a tutor message.
 */
export async function checkGuidedItemsQuota(
  db: Db,
  userId: string,
  accountKind: AccountKind,
  config: QuotaConfig,
  now: Date = new Date(),
): Promise<QuotaCheckResult> {
  const daily = await getOrCreateQuota(db, userId, "daily", capsFor(accountKind, config, "daily"), now);
  const monthly = await getOrCreateQuota(db, userId, "monthly", capsFor(accountKind, config, "monthly"), now);
  if (accountKind === "internal_dev") return { ok: true, quotas: { daily, monthly } };

  const dailyCost = daily.costUsdEstimate ?? 0;
  const monthlyCost = monthly.costUsdEstimate ?? 0;
  if (daily.capCostUsd !== null && dailyCost >= daily.capCostUsd) {
    return { ok: false, reason: "cost_cap" };
  }
  if (monthly.capCostUsd !== null && monthlyCost >= monthly.capCostUsd) {
    return { ok: false, reason: "cost_cap" };
  }
  return { ok: true, quotas: { daily, monthly } };
}

/** Record-only after a real guided-items model call (success or structured failure). */
export async function recordGuidedItemsUsage(
  db: Db,
  userId: string,
  accountKind: AccountKind,
  config: QuotaConfig,
  costUsd: number | null,
  now: Date = new Date(),
): Promise<void> {
  const daily = await getOrCreateQuota(db, userId, "daily", capsFor(accountKind, config, "daily"), now);
  const monthly = await getOrCreateQuota(db, userId, "monthly", capsFor(accountKind, config, "monthly"), now);
  await recordQuotaUsage(db, { daily, monthly }, "guided_items", costUsd);
}

/**
 * P2 FIX5 (2026-07-21 post-real-run REVIEW): durable cost recording for the
 * temario-builder — a generation call already happened by the time its
 * `costUsd` is known (routes/temarios.ts awaits `generateTemario` first), so
 * this is record-only, not a pre-flight cap check like `checkTutorQuota`/
 * `checkIngestQuota` (there is nothing to "block before spend" here — the
 * spend already occurred with the founder's Anthropic key). It gets/creates
 * both quota rows (same as every other kind) and folds the cost into the
 * SAME `costUsdEstimate` the tutor/assessor/judge/ingest calls already
 * accumulate into — so a temario-builder run counts toward the same overall
 * USD cap, and is finally consultable (`usage_quotas.cost_usd_estimate`)
 * where before (`NoopTelemetrySink`) it was invisible even on success.
 */
export async function recordTemarioBuilderUsage(
  db: Db,
  userId: string,
  accountKind: AccountKind,
  config: QuotaConfig,
  costUsd: number | null,
  now: Date = new Date(),
): Promise<void> {
  const daily = await getOrCreateQuota(db, userId, "daily", capsFor(accountKind, config, "daily"), now);
  const monthly = await getOrCreateQuota(db, userId, "monthly", capsFor(accountKind, config, "monthly"), now);
  await recordQuotaUsage(db, { daily, monthly }, "temario_builder", costUsd);
}

export type IngestQuotaCheckResult =
  | { ok: true; quotas: QuotaCheck }
  | { ok: false; reason: "daily_ingest_pages" | "monthly_ingest_pages" | "cost_cap" };

/**
 * F2 WQ1 — checked ONCE per material upload, up front, against the number
 * of cloud-tier pages THIS request would transcribe (`cloudPageCount`) —
 * "block before spend", same pattern as `checkTutorQuota`, but batch-aware
 * (a single multi-page upload must not blow past the cap in one request the
 * way per-message tutor checks, evaluated one message at a time, naturally
 * can't).
 */
export async function checkIngestQuota(
  db: Db,
  userId: string,
  accountKind: AccountKind,
  config: QuotaConfig,
  cloudPageCount: number,
  now: Date = new Date(),
): Promise<IngestQuotaCheckResult> {
  const daily = await getOrCreateQuota(db, userId, "daily", capsFor(accountKind, config, "daily"), now);
  const monthly = await getOrCreateQuota(db, userId, "monthly", capsFor(accountKind, config, "monthly"), now);

  if (accountKind !== "internal_dev") {
    if (daily.ingestCloudCallsUsed + cloudPageCount > config.dailyIngestCloudPages) {
      return { ok: false, reason: "daily_ingest_pages" };
    }
    if (monthly.ingestCloudCallsUsed + cloudPageCount > config.monthlyIngestCloudPages) {
      return { ok: false, reason: "monthly_ingest_pages" };
    }
  }
  const dailyCost = daily.costUsdEstimate ?? 0;
  const monthlyCost = monthly.costUsdEstimate ?? 0;
  if (daily.capCostUsd !== null && dailyCost >= daily.capCostUsd) {
    return { ok: false, reason: "cost_cap" };
  }
  if (monthly.capCostUsd !== null && monthlyCost >= monthly.capCostUsd) {
    return { ok: false, reason: "cost_cap" };
  }

  return { ok: true, quotas: { daily, monthly } };
}
