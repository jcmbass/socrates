/**
 * Fuente repository — Fase P1.
 *
 * Fuentes are text-only study materials scoped to (userId, subjectId).
 * The write path enforces the text-only invariant P0-6.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { fuentes } from "../db/schema";
import type { Fuente, FuenteKind } from "@buxo/domain/fuente";
import { emptyFuente } from "@buxo/domain/fuente";
import { assertFuenteTextOnly } from "@buxo/domain/invariants";

function rowToFuente(row: typeof fuentes.$inferSelect): Fuente {
  return {
    id: row.id,
    subjectId: row.subjectId,
    userId: row.userId,
    name: row.name,
    kind: row.kind,
    text: row.text,
    tokens: row.tokens ?? undefined,
    createdAt: row.createdAt,
    schemaVersion: row.schemaVersion,
  };
}

export interface CreateFuenteInput {
  userId: string;
  subjectId: string;
  name: string;
  kind: FuenteKind;
  text: string;
  tokens?: number;
}

export async function createFuente(db: Db, input: CreateFuenteInput): Promise<Fuente> {
  const fuente = emptyFuente({
    userId: input.userId,
    subjectId: input.subjectId,
    name: input.name,
    kind: input.kind,
    text: input.text,
    tokens: input.tokens,
  });
  assertFuenteTextOnly(fuente);

  const [row] = await db
    .insert(fuentes)
    .values({
      id: fuente.id,
      subjectId: fuente.subjectId,
      userId: fuente.userId,
      name: fuente.name,
      kind: fuente.kind,
      text: fuente.text,
      tokens: fuente.tokens ?? null,
      createdAt: fuente.createdAt,
      schemaVersion: 1,
    })
    .returning();
  return rowToFuente(row);
}

export async function findFuenteById(db: Db, id: string): Promise<Fuente | null> {
  const [row] = await db.select().from(fuentes).where(eq(fuentes.id, id)).limit(1);
  return row ? rowToFuente(row) : null;
}

export async function listFuentesBySubject(db: Db, userId: string, subjectId: string): Promise<Fuente[]> {
  const rows = await db
    .select()
    .from(fuentes)
    .where(and(eq(fuentes.userId, userId), eq(fuentes.subjectId, subjectId)))
    .orderBy(fuentes.createdAt);
  return rows.map(rowToFuente);
}

export async function updateFuente(db: Db, id: string, input: { name?: string; text?: string; tokens?: number }): Promise<Fuente | null> {
  const existing = await findFuenteById(db, id);
  if (!existing) return null;

  const updates: Partial<typeof fuentes.$inferSelect> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.text !== undefined) updates.text = input.text;
  if (input.tokens !== undefined) updates.tokens = input.tokens;

  const candidate = rowToFuente({ ...existing, ...updates } as typeof fuentes.$inferSelect);
  assertFuenteTextOnly(candidate);

  const [row] = await db.update(fuentes).set(updates).where(eq(fuentes.id, id)).returning();
  return row ? rowToFuente(row) : null;
}

export async function deleteFuente(db: Db, id: string): Promise<void> {
  await db.delete(fuentes).where(eq(fuentes.id, id));
}

export async function fuenteBelongsToUser(db: Db, id: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: fuentes.id }).from(fuentes).where(and(eq(fuentes.id, id), eq(fuentes.userId, userId))).limit(1);
  return !!row;
}
