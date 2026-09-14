/**
 * Temario / Tema / Hito repository — Fase P1.
 *
 * All write paths are transactional where multiple rows must move together
 * (create the empty temario, reorder topics, update the recommended flag).
 * Domain invariants P0-1..P0-5 are checked inside the write path with the
 * strongest executable proxies available without store access.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hitos, temarios, temas } from "../db/schema";
import type { Hito, Tema, Temario, TemarioGeneratedBy } from "@buxo/domain/temario";
import {
  assertHitoCoversWithinTemario,
  assertTemarioOwnedBySubjectUser,
  assertTopicTitleSanitized,
} from "@buxo/domain/invariants";
import { createMilestone, createTopic, emptyTemario } from "@buxo/domain/temario";
import { nowIso } from "./ids";

function rowToTema(row: typeof temas.$inferSelect): Tema {
  return {
    id: row.id,
    temarioId: row.temarioId,
    order: row.order,
    title: row.title,
    status: row.status,
    stars: row.stars as 0 | 1 | 2 | 3,
    recommended: row.recommended,
    unitLabel: row.unitLabel,
    schemaVersion: row.schemaVersion,
  };
}

function rowToHito(row: typeof hitos.$inferSelect): Hito {
  return {
    id: row.id,
    temarioId: row.temarioId,
    order: row.order,
    kind: row.kind,
    title: row.title,
    coversUpToOrder: row.coversUpToOrder,
    status: row.status,
    schemaVersion: row.schemaVersion,
  };
}

function rowToTemario(row: typeof temarios.$inferSelect, topics: Tema[], milestones: Hito[]): Temario {
  return {
    id: row.id,
    subjectId: row.subjectId,
    userId: row.userId,
    topics,
    milestones,
    generatedBy: row.generatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    schemaVersion: row.schemaVersion,
  };
}

export interface CreateTemarioInput {
  userId: string;
  subjectId: string;
  generatedBy?: TemarioGeneratedBy;
}

export async function createTemario(db: Db, input: CreateTemarioInput): Promise<Temario> {
  const temario = emptyTemario({
    userId: input.userId,
    subjectId: input.subjectId,
    generatedBy: input.generatedBy,
  });
  assertTemarioOwnedBySubjectUser(temario, input.subjectId, input.userId);

  const now = nowIso();
  const [row] = await db
    .insert(temarios)
    .values({
      id: temario.id,
      subjectId: temario.subjectId,
      userId: temario.userId,
      generatedBy: temario.generatedBy,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    })
    .returning();
  return rowToTemario(row, [], []);
}

export async function findTemarioBySubject(db: Db, subjectId: string): Promise<Temario | null> {
  const [row] = await db.select().from(temarios).where(eq(temarios.subjectId, subjectId)).limit(1);
  if (!row) return null;
  const [topics, milestones] = await Promise.all([
    db.select().from(temas).where(eq(temas.temarioId, row.id)).orderBy(asc(temas.order)),
    db.select().from(hitos).where(eq(hitos.temarioId, row.id)).orderBy(asc(hitos.order)),
  ]);
  return rowToTemario(row, topics.map(rowToTema), milestones.map(rowToHito));
}

export async function findTemarioById(db: Db, id: string): Promise<Temario | null> {
  const [row] = await db.select().from(temarios).where(eq(temarios.id, id)).limit(1);
  if (!row) return null;
  const [topics, milestones] = await Promise.all([
    db.select().from(temas).where(eq(temas.temarioId, row.id)).orderBy(asc(temas.order)),
    db.select().from(hitos).where(eq(hitos.temarioId, row.id)).orderBy(asc(hitos.order)),
  ]);
  return rowToTemario(row, topics.map(rowToTema), milestones.map(rowToHito));
}

export async function temarioBelongsToUser(db: Db, id: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: temarios.id }).from(temarios).where(and(eq(temarios.id, id), eq(temarios.userId, userId))).limit(1);
  return !!row;
}

export interface CreateTopicInput {
  temarioId: string;
  title: string;
  order?: number;
  /** Syllabus unit/chapter label from a seed catalog (C1-b). */
  unitLabel?: string | null;
}

/**
 * Insert a topic at the end of the temario unless an explicit order is given.
 * The caller (route/tool) is responsible for auth-scope before calling.
 *
 * P2 FIX2 (2026-07-21 post-real-run REVIEW): when `order` is omitted, the
 * next order is computed as `MAX(order) + 1` (falling back to 0 for an
 * empty temario) inside a transaction, NOT the count of already-loaded
 * topics — this is the append-atomically contract the temario-builder tool
 * relies on (`createTopicTool` never forwards a model-supplied `order`).
 * `MAX+1` is also correct for the manual P1 CRUD path even if topics were
 * ever deleted (leaving a gap), where `.length` would have been wrong.
 */
export async function createTopicInTemario(db: Db, input: CreateTopicInput): Promise<Tema> {
  return db.transaction(async (tx) => {
    const [exists] = await tx.select({ id: temarios.id }).from(temarios).where(eq(temarios.id, input.temarioId)).limit(1);
    if (!exists) throw new Error(`Temario ${input.temarioId} not found`);

    let order = input.order;
    if (order === undefined) {
      const [{ maxOrder }] = await tx
        .select({ maxOrder: sql<number | null>`max(${temas.order})` })
        .from(temas)
        .where(eq(temas.temarioId, input.temarioId));
      order = (maxOrder ?? -1) + 1;
    }

    const topic = createTopic({ temarioId: input.temarioId, order, title: input.title, unitLabel: input.unitLabel });
    assertTopicTitleSanitized(topic.title);

    const [row] = await tx
      .insert(temas)
      .values({
        id: topic.id,
        temarioId: topic.temarioId,
        order: topic.order,
        title: topic.title,
        status: topic.status,
        stars: topic.stars,
        recommended: topic.recommended,
        unitLabel: topic.unitLabel,
        schemaVersion: 1,
      })
      .returning();
    return rowToTema(row);
  });
}

export interface CreateTopicBatchInput {
  title: string;
  /** Syllabus unit/chapter label from a seed catalog (C1-b). */
  unitLabel?: string | null;
}

/**
 * Bulk-insert topics into a temario as ONE `INSERT ... VALUES` inside ONE
 * transaction (C2-a). `createTopicInTemario` opens a transaction and runs a
 * `SELECT max(order)` PER topic — fine for the manual CRUD path (a handful
 * of topics at a time), unacceptable for activating a seed subject: some
 * catalogs run to 200+ topics (`universidad/biologia` 206,
 * `universidad/fisica` en 236 — see `01-plan-c0.md` §R-2), which would be
 * 200+ round-trip transactions during onboarding.
 *
 * `order` is computed ONCE in memory from the same `MAX(order)+1` base
 * `createTopicInTemario` uses (append-atomically, P2 FIX2), then assigned
 * sequentially to the batch — correct for the seed-activation call site,
 * which always targets a brand-new, empty temario, and still correct in
 * general (append after whatever already exists).
 */
export async function createTopicsInTemario(db: Db, temarioId: string, topics: CreateTopicBatchInput[]): Promise<Tema[]> {
  if (topics.length === 0) return [];

  return db.transaction(async (tx) => {
    const [exists] = await tx.select({ id: temarios.id }).from(temarios).where(eq(temarios.id, temarioId)).limit(1);
    if (!exists) throw new Error(`Temario ${temarioId} not found`);

    const [{ maxOrder }] = await tx
      .select({ maxOrder: sql<number | null>`max(${temas.order})` })
      .from(temas)
      .where(eq(temas.temarioId, temarioId));
    let nextOrder = (maxOrder ?? -1) + 1;

    const values = topics.map((input) => {
      const topic = createTopic({ temarioId, order: nextOrder++, title: input.title, unitLabel: input.unitLabel });
      assertTopicTitleSanitized(topic.title);
      return {
        id: topic.id,
        temarioId: topic.temarioId,
        order: topic.order,
        title: topic.title,
        status: topic.status,
        stars: topic.stars,
        recommended: topic.recommended,
        unitLabel: topic.unitLabel,
        schemaVersion: 1,
      };
    });

    const rows = await tx.insert(temas).values(values).returning();
    return rows.map(rowToTema);
  });
}

/** Case-insensitive, trimmed title lookup within a temario — backs the builder tool's idempotent dedup (P2 FIX2). */
export async function findTopicByTitle(db: Db, temarioId: string, title: string): Promise<Tema | null> {
  const rows = await db.select().from(temas).where(eq(temas.temarioId, temarioId));
  const normalized = title.trim().toLowerCase();
  const match = rows.find((r) => r.title.trim().toLowerCase() === normalized);
  return match ? rowToTema(match) : null;
}

/** Same dedup lookup as `findTopicByTitle`, for milestones (P2 FIX2). */
export async function findMilestoneByTitle(db: Db, temarioId: string, title: string): Promise<Hito | null> {
  const rows = await db.select().from(hitos).where(eq(hitos.temarioId, temarioId));
  const normalized = title.trim().toLowerCase();
  const match = rows.find((r) => r.title.trim().toLowerCase() === normalized);
  return match ? rowToHito(match) : null;
}

export interface UpdateTopicInput {
  id: string;
  title?: string;
  order?: number;
  recommended?: boolean;
  /** Server-only progress wiring (plan-xp-progreso Fase 1) — not exposed on client-write routes. */
  status?: "new" | "studying" | "done";
  /** Server-only — written via tierToStars from mastery aggregation; never from the client body. */
  stars?: 0 | 1 | 2 | 3;
}

export async function updateTopicInTemario(db: Db, input: UpdateTopicInput): Promise<Tema> {
  const existing = await db.select().from(temas).where(eq(temas.id, input.id)).limit(1);
  if (existing.length === 0) throw new Error(`Tema ${input.id} not found`);

  const updates: Partial<typeof temas.$inferSelect> = {};
  if (input.title !== undefined) {
    assertTopicTitleSanitized(input.title);
    updates.title = input.title;
  }
  if (input.order !== undefined) updates.order = input.order;
  if (input.recommended !== undefined) updates.recommended = input.recommended;
  if (input.status !== undefined) updates.status = input.status;
  if (input.stars !== undefined) updates.stars = input.stars;

  const [row] = await db.update(temas).set(updates).where(eq(temas.id, input.id)).returning();
  return rowToTema(row!);
}

/** Mark a topic as studying if it is still `new`. No-op for studying/done. */
export async function markTopicStudyingIfNew(db: Db, topicId: string): Promise<void> {
  const existing = await db.select().from(temas).where(eq(temas.id, topicId)).limit(1);
  if (existing.length === 0) return;
  if (existing[0]!.status !== "new") return;
  await db.update(temas).set({ status: "studying" }).where(eq(temas.id, topicId));
}


export async function deleteTopicFromTemario(db: Db, id: string): Promise<void> {
  await db.delete(temas).where(eq(temas.id, id));
}

/**
 * Reorder topics to the given id list. The list need not include every topic;
 * omitted topics keep their relative order after the explicitly ordered ones.
 * Every topic in the list must belong to the same temario.
 */
export async function reorderTopicsInTemario(db: Db, temarioId: string, orderedIds: string[]): Promise<Tema[]> {
  return db.transaction(async (tx) => {
    const all = await tx.select().from(temas).where(eq(temas.temarioId, temarioId)).orderBy(asc(temas.order));
    const byId = new Map(all.map((t) => [t.id, t]));

    for (const id of orderedIds) {
      if (!byId.has(id)) throw new Error(`Tema ${id} does not belong to temario ${temarioId}`);
    }

    // Bugfix (2026-07-25, post-M3-smoke REVIEW): capture, BEFORE mutating any
    // order, which topic IDENTITY each existing milestone's `coversUpToOrder`
    // currently resolves to. `coversUpToOrder` is a snapshot of a topic's
    // POSITION at write time, not a reference to the topic itself — if we
    // reorder topics without also updating milestones, every milestone keeps
    // pointing at the same NUMBER while the topic that used to sit there has
    // moved elsewhere. The milestone's promised scope silently corrupts with
    // no error (this is a structurally distinct failure mode from the
    // "model miscounts the index at creation time" bug fixed the same day by
    // `createMilestoneTool`'s `coversUpToTopicTitle`; this one requires a fix
    // HERE because `reorderTopics` is the only place topic order changes
    // after a milestone already exists).
    const existingHitos = await tx.select().from(hitos).where(eq(hitos.temarioId, temarioId));
    const topicIdByOldOrder = new Map(all.map((t) => [t.order, t.id]));
    const coveredTopicIdByHitoId = new Map(existingHitos.map((h) => [h.id, topicIdByOldOrder.get(h.coversUpToOrder) ?? null]));

    const explicit = orderedIds.map((id) => byId.get(id)!);
    const implicit = all.filter((t) => !orderedIds.includes(t.id));
    const combined = [...explicit, ...implicit];

    const updates = combined.map((t, i) => ({ id: t.id, order: i }));
    // P2 real-API bug #7 (2026-07-21, exposed by Haiku actually calling
    // reorderTopics after createTopic — fakes never exercised this path):
    // `temas_temario_id_order_unique` is a live (non-deferrable) constraint,
    // checked per-statement. Writing final orders in a single pass throws on
    // ANY non-identity permutation whose target order is still held by a
    // different row that hasn't been updated yet (e.g. moving the topic at
    // order 5 to order 0 while another topic still sits at order 0). Two
    // passes avoid every transient collision: first move every touched row
    // to a negative, mutually-disjoint scratch value (guaranteed never to
    // collide with any current or future non-negative order), then assign
    // the real final orders once no row can be holding a colliding value.
    for (const u of updates) {
      await tx.update(temas).set({ order: -(u.order + 1) }).where(eq(temas.id, u.id));
    }
    for (const u of updates) {
      await tx.update(temas).set({ order: u.order }).where(eq(temas.id, u.id));
    }

    // Re-derive every milestone's `coversUpToOrder` from the SAME topic
    // identity it pointed at before the reorder, using its NEW position.
    // A milestone whose covered topic was deleted out from under it (edge
    // case: `topicIdByOldOrder` had no entry, or the topic no longer exists)
    // is left untouched — reorder is not the place to invent a new scope for
    // a dangling reference; `updateMilestoneInTemario`/`assertHitoCoversWithinTemario`
    // remain the guard against that surfacing as an invalid state.
    if (existingHitos.length > 0) {
      const newOrderByTopicId = new Map(updates.map((u) => [u.id, u.order]));
      for (const h of existingHitos) {
        const coveredTopicId = coveredTopicIdByHitoId.get(h.id);
        if (!coveredTopicId) continue;
        const newOrder = newOrderByTopicId.get(coveredTopicId);
        if (newOrder === undefined || newOrder === h.coversUpToOrder) continue;
        await tx.update(hitos).set({ coversUpToOrder: newOrder }).where(eq(hitos.id, h.id));
      }
    }

    const refreshed = await tx.select().from(temas).where(eq(temas.temarioId, temarioId)).orderBy(asc(temas.order));
    return refreshed.map(rowToTema);
  });
}

/**
 * Mark a single topic as recommended and every other topic of the same
 * temario as not recommended, atomically.
 */
export async function setRecommendedTopic(db: Db, temarioId: string, topicId: string): Promise<Tema> {
  return db.transaction(async (tx) => {
    const [topic] = await tx.select().from(temas).where(and(eq(temas.id, topicId), eq(temas.temarioId, temarioId))).limit(1);
    if (!topic) throw new Error(`Tema ${topicId} not found in temario ${temarioId}`);

    await tx.update(temas).set({ recommended: false }).where(eq(temas.temarioId, temarioId));
    const [updated] = await tx.update(temas).set({ recommended: true }).where(eq(temas.id, topicId)).returning();
    return rowToTema(updated!);
  });
}

export interface CreateMilestoneInput {
  temarioId: string;
  kind: "parcial" | "examen_final";
  title: string;
  coversUpToOrder: number;
  order?: number;
}

/**
 * P2 FIX2 (2026-07-21 post-real-run REVIEW): same append-atomically
 * contract as `createTopicInTemario` — when `order` is omitted, it's
 * computed inside a transaction from `MAX(hitos.order)+1` (or the topic
 * count, preserving the pre-fix "milestones start after the topics" default
 * for the first milestone), never `.length` off a snapshot read outside a
 * transaction.
 */
export async function createMilestoneInTemario(db: Db, input: CreateMilestoneInput): Promise<Hito> {
  return db.transaction(async (tx) => {
    const [exists] = await tx.select({ id: temarios.id }).from(temarios).where(eq(temarios.id, input.temarioId)).limit(1);
    if (!exists) throw new Error(`Temario ${input.temarioId} not found`);

    const [{ maxTopicOrder }] = await tx
      .select({ maxTopicOrder: sql<number | null>`max(${temas.order})` })
      .from(temas)
      .where(eq(temas.temarioId, input.temarioId));
    const maxOrder = maxTopicOrder ?? -1;

    let order = input.order;
    if (order === undefined) {
      const [{ maxMilestoneOrder }] = await tx
        .select({ maxMilestoneOrder: sql<number | null>`max(${hitos.order})` })
        .from(hitos)
        .where(eq(hitos.temarioId, input.temarioId));
      order = maxMilestoneOrder !== null ? maxMilestoneOrder + 1 : maxOrder + 1;
    }

    const milestone = createMilestone({
      temarioId: input.temarioId,
      order,
      kind: input.kind,
      title: input.title,
      coversUpToOrder: input.coversUpToOrder,
    });
    assertTopicTitleSanitized(milestone.title);
    assertHitoCoversWithinTemario(milestone, maxOrder);

    const [row] = await tx
      .insert(hitos)
      .values({
        id: milestone.id,
        temarioId: milestone.temarioId,
        order: milestone.order,
        kind: milestone.kind,
        title: milestone.title,
        coversUpToOrder: milestone.coversUpToOrder,
        status: milestone.status,
        schemaVersion: 1,
      })
      .returning();
    return rowToHito(row);
  });
}

export interface UpdateMilestoneInput {
  id: string;
  title?: string;
  order?: number;
  coversUpToOrder?: number;
}

export async function updateMilestoneInTemario(db: Db, input: UpdateMilestoneInput): Promise<Hito> {
  const existing = await db.select().from(hitos).where(eq(hitos.id, input.id)).limit(1);
  if (existing.length === 0) throw new Error(`Hito ${input.id} not found`);

  const updates: Partial<typeof hitos.$inferSelect> = {};
  if (input.title !== undefined) {
    assertTopicTitleSanitized(input.title);
    updates.title = input.title;
  }
  if (input.order !== undefined) updates.order = input.order;
  if (input.coversUpToOrder !== undefined) {
    const temario = await findTemarioById(db, existing[0]!.temarioId);
    const maxOrder = temario && temario.topics.length > 0 ? Math.max(...temario.topics.map((t) => t.order)) : -1;
    const candidate = rowToHito({ ...existing[0]!, coversUpToOrder: input.coversUpToOrder });
    assertHitoCoversWithinTemario(candidate, maxOrder);
    updates.coversUpToOrder = input.coversUpToOrder;
  }

  const [row] = await db.update(hitos).set(updates).where(eq(hitos.id, input.id)).returning();
  return rowToHito(row!);
}

export async function deleteMilestoneFromTemario(db: Db, id: string): Promise<void> {
  await db.delete(hitos).where(eq(hitos.id, id));
}

export async function updateTemarioGeneratedBy(
  db: Db,
  id: string,
  generatedBy: TemarioGeneratedBy,
): Promise<Temario | null> {
  const [row] = await db.update(temarios).set({ generatedBy, updatedAt: nowIso() }).where(eq(temarios.id, id)).returning();
  if (!row) return null;
  return findTemarioById(db, id);
}
