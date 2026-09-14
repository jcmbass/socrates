/**
 * UsageQuota — B3-modelo-de-dominio.md §2.12.
 *
 * Modeled generically (D3, unit economics, has no real numbers yet — B3 §0
 * point 8, §8 R-9). Unique per (userId, period, periodKey) — invariant
 * I-10; counters never negative — same invariant.
 */
import { z } from "zod";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

export const QUOTA_PERIODS = ["daily", "monthly"] as const;
export type QuotaPeriod = (typeof QUOTA_PERIODS)[number];

export interface UsageQuota {
  id: string;
  userId: string;
  period: QuotaPeriod;
  /** "2026-07-12" (daily) | "2026-07" (monthly) — único por (userId, period, periodKey), invariante I-10. */
  periodKey: string;
  tutorMessagesUsed: number;
  assessorCallsUsed: number;
  judgeCallsUsed: number;
  /** Fallback-nube de C4 — línea de costo distinta para D3. */
  ingestCloudCallsUsed: number;
  /** PB2: null = costo no medible (precio del modelo desconocido en el registry), no confundir con $0. */
  costUsdEstimate: number | null;
  /** PB5: true cuando al menos un recordUsage recibió costUsd=null — el total no es completo. */
  costUsdIncomplete: boolean;
  /** null = sin límite (p.ej. accountKind:"internal_dev"). */
  capTutorMessages: number | null;
  capCostUsd: number | null;
  resetAt: string;
  schemaVersion: number;
}

export const UsageQuotaSchema: z.ZodType<UsageQuota> = z.object({
  id: idSchema,
  userId: idSchema,
  period: z.enum(QUOTA_PERIODS),
  periodKey: z.string().min(1),
  tutorMessagesUsed: z.number().int().min(0),
  assessorCallsUsed: z.number().int().min(0),
  judgeCallsUsed: z.number().int().min(0),
  ingestCloudCallsUsed: z.number().int().min(0),
  costUsdEstimate: z.number().min(0).nullable(),
  costUsdIncomplete: z.boolean(),
  capTutorMessages: z.number().int().min(0).nullable(),
  capCostUsd: z.number().min(0).nullable(),
  resetAt: isoTimestampSchema,
  schemaVersion: schemaVersionSchema,
});
