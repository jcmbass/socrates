import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { safetyIncidents } from "../db/schema";
import type { SafetyIncident } from "../safety/incident";
import { newId, nowIso } from "./ids";
import type { SafetyCategory } from "../safety/classifier";

function rowToIncident(row: typeof safetyIncidents.$inferSelect): SafetyIncident {
  return {
    id: row.id,
    userId: row.userId,
    sessionId: row.sessionId,
    exchangeId: row.exchangeId,
    category: row.category,
    detectedAt: row.detectedAt,
    classifierProviderId: row.classifierProviderId,
    classifierModelId: row.classifierModelId,
    triggeringText: row.triggeringText ?? null,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
    reviewNotes: row.reviewNotes,
    schemaVersion: row.schemaVersion,
  };
}

export interface CreateSafetyIncidentInput {
  userId: string;
  sessionId: string;
  exchangeId: string | null;
  category: Exclude<SafetyCategory, "none">;
  classifierProviderId: string;
  classifierModelId: string;
  /** Plan-xp-progreso Fase 3.1 — exact student message that triggered the block. */
  triggeringText?: string | null;
}

export async function createSafetyIncident(db: Db, input: CreateSafetyIncidentInput): Promise<SafetyIncident> {
  const [row] = await db
    .insert(safetyIncidents)
    .values({
      id: newId(),
      userId: input.userId,
      sessionId: input.sessionId,
      exchangeId: input.exchangeId,
      category: input.category,
      detectedAt: nowIso(),
      classifierProviderId: input.classifierProviderId,
      classifierModelId: input.classifierModelId,
      triggeringText: input.triggeringText ?? null,
      reviewedAt: null,
      reviewedBy: null,
      reviewNotes: null,
      schemaVersion: 1,
    })
    .returning();
  return rowToIncident(row);
}


export async function listSafetyIncidentsByUser(db: Db, userId: string): Promise<SafetyIncident[]> {
  const rows = await db.select().from(safetyIncidents).where(eq(safetyIncidents.userId, userId));
  return rows.map(rowToIncident);
}
