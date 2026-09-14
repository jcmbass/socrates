/**
 * Quota rejection ledger — plan-xp-progreso Fase 3.2.
 * One row per time a student hits a hard quota ceiling.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { quotaRejections } from "../db/schema";
import { newId, nowIso } from "./ids";

export type QuotaRejectionReason =
  | "daily_messages"
  | "monthly_messages"
  | "cost_cap"
  | "daily_ingest_pages"
  | "monthly_ingest_pages";

export type QuotaRejectionSurface = "tutor" | "ingest" | "guided_items";

export interface QuotaRejection {
  id: string;
  userId: string;
  reason: QuotaRejectionReason;
  surface: QuotaRejectionSurface;
  rejectedAt: string;
  schemaVersion: number;
}

export interface CreateQuotaRejectionInput {
  userId: string;
  reason: QuotaRejectionReason;
  surface: QuotaRejectionSurface;
}

export async function createQuotaRejection(db: Db, input: CreateQuotaRejectionInput): Promise<QuotaRejection> {
  const [row] = await db
    .insert(quotaRejections)
    .values({
      id: newId(),
      userId: input.userId,
      reason: input.reason,
      surface: input.surface,
      rejectedAt: nowIso(),
      schemaVersion: 1,
    })
    .returning();
  return {
    id: row.id,
    userId: row.userId,
    reason: row.reason,
    surface: row.surface,
    rejectedAt: row.rejectedAt,
    schemaVersion: row.schemaVersion,
  };
}

export async function listQuotaRejectionsByUser(db: Db, userId: string): Promise<QuotaRejection[]> {
  const rows = await db.select().from(quotaRejections).where(eq(quotaRejections.userId, userId));
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    reason: row.reason,
    surface: row.surface,
    rejectedAt: row.rejectedAt,
    schemaVersion: row.schemaVersion,
  }));
}
