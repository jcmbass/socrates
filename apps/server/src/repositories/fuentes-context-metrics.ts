/**
 * plan-modal-rag F0.1 — persist truncation metrics without blocking the turn.
 *
 * Callers MUST fire-and-forget (`void record…().catch(log)`). A lost metric
 * must never break a student turn.
 */
import type { Db } from "../db/client";
import { fuentesContextMetrics } from "../db/schema";
import type { FuentesContextMetrics } from "../materials/session-context";
import { newId, nowIso } from "./ids";

export type FuentesContextMetricsRow = {
  id: string;
  createdAt: string;
  subjectId: string;
  sessionId: string;
  kind: "topic" | "milestone";
  builder: "fuentes" | "topic";
  fuenteCount: number;
  corpusTokens: number;
  truncated: boolean;
  droppedTokens: number;
};

export async function recordFuentesContextMetrics(
  db: Db,
  metrics: FuentesContextMetrics,
): Promise<FuentesContextMetricsRow> {
  if (!metrics.subjectId || !metrics.sessionId) {
    throw new Error("recordFuentesContextMetrics requires subjectId and sessionId");
  }
  const kind = metrics.kind === "milestone" ? "milestone" : "topic";
  const [row] = await db
    .insert(fuentesContextMetrics)
    .values({
      id: newId(),
      createdAt: nowIso(),
      subjectId: metrics.subjectId,
      sessionId: metrics.sessionId,
      kind,
      builder: metrics.builder,
      fuenteCount: metrics.fuenteCount,
      corpusTokens: metrics.corpusTokens,
      truncated: metrics.truncated,
      droppedTokens: metrics.droppedTokens,
    })
    .returning();

  return {
    id: row.id,
    createdAt: row.createdAt,
    subjectId: row.subjectId,
    sessionId: row.sessionId,
    kind: row.kind,
    builder: row.builder,
    fuenteCount: row.fuenteCount,
    corpusTokens: row.corpusTokens,
    truncated: row.truncated,
    droppedTokens: row.droppedTokens,
  };
}
