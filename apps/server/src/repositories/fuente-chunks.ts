/**
 * plan-modal-rag F2 — persist Fuente chunks + embeddings.
 * Offline pipeline / future F3 only — no student-facing route reads this yet.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { FUENTE_CHUNK_EMBEDDING_DIMS, fuenteChunks } from "../db/schema";
import type { FuenteChunkDraft } from "../materials/chunk-fuentes";
import { newId, nowIso } from "./ids";

export type FuenteChunkRow = {
  id: string;
  subjectId: string;
  fuenteId: string;
  fuenteName: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
  modelId: string;
  createdAt: string;
};

export type PersistFuenteChunksInput = {
  subjectId: string;
  modelId: string;
  chunks: ReadonlyArray<FuenteChunkDraft & { embedding: number[] }>;
};

function assertEmbedding(vec: number[]): void {
  if (vec.length !== FUENTE_CHUNK_EMBEDDING_DIMS) {
    throw new Error(
      `embedding dim ${vec.length} !== ${FUENTE_CHUNK_EMBEDDING_DIMS}`,
    );
  }
}

/**
 * Replace all chunks for the fuentes present in `chunks` (idempotent re-run).
 * Scoped by subjectId — never mixes materias (D4).
 */
export async function replaceFuenteChunksForFuentes(
  db: Db,
  input: PersistFuenteChunksInput,
): Promise<{ written: number; deleted: number }> {
  const fuenteIds = [...new Set(input.chunks.map((c) => c.fuenteId))];
  if (fuenteIds.length === 0) return { written: 0, deleted: 0 };

  for (const c of input.chunks) {
    if (c.subjectId !== input.subjectId) {
      throw new Error(
        `chunk subjectId ${c.subjectId} !== batch subjectId ${input.subjectId}`,
      );
    }
    assertEmbedding(c.embedding);
  }

  return db.transaction(async (tx) => {
    let deleted = 0;
    for (const fuenteId of fuenteIds) {
      const removed = await tx
        .delete(fuenteChunks)
        .where(
          and(
            eq(fuenteChunks.subjectId, input.subjectId),
            eq(fuenteChunks.fuenteId, fuenteId),
          ),
        )
        .returning({ id: fuenteChunks.id });
      deleted += removed.length;
    }

    if (input.chunks.length === 0) return { written: 0, deleted };

    const createdAt = nowIso();
    const values = input.chunks.map((c) => ({
      id: newId(),
      subjectId: c.subjectId,
      fuenteId: c.fuenteId,
      fuenteName: c.fuenteName,
      chunkIndex: c.chunkIndex,
      text: c.text,
      embedding: c.embedding,
      modelId: input.modelId,
      createdAt,
    }));

    await tx.insert(fuenteChunks).values(values);
    return { written: values.length, deleted };
  });
}

/** Count chunks for a subject (F2 smoke / metrics). */
export async function countFuenteChunksForSubject(
  db: Db,
  subjectId: string,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(fuenteChunks)
    .where(eq(fuenteChunks.subjectId, subjectId));
  return Number(rows[0]?.n ?? 0);
}
