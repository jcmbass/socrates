/**
 * MasteryState / MasteryHistoryEntry repository — B2-motor-de-dominio.md
 * §2/§9.1, F2 WQ3 parte B1. The ONLY write path for these two tables
 * (I-2: a `MasteryState` never exists without its `MasteryHistoryEntry`,
 * same operation — enforced here via a single `db.transaction`, then
 * re-checked with `@buxo/domain/invariants`' executable proxy before
 * returning, belt-and-suspenders against a future caller bypassing this
 * module).
 */
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { masteryHistoryEntries, masteryStates } from "../db/schema";
import type { MasteryHistoryEntry, MasteryLevel, MasteryState, MasteryVisibility } from "@buxo/domain/mastery";
import { assertMasteryStateWrittenWithHistoryEntry } from "@buxo/domain/invariants";
import { newId, nowIso } from "./ids";

function rowToMasteryState(row: typeof masteryStates.$inferSelect): MasteryState {
  return {
    id: row.id,
    userId: row.userId,
    subjectId: row.subjectId,
    topicKey: row.topicKey,
    topicId: row.topicId ?? null,
    currentLevel: row.currentLevel,
    visibility: row.visibility,
    lastHistoryEntryId: row.lastHistoryEntryId,
    updatedAt: row.updatedAt,
    schemaVersion: row.schemaVersion,
  };
}

function rowToHistoryEntry(row: typeof masteryHistoryEntries.$inferSelect): MasteryHistoryEntry {
  return {
    id: row.id,
    userId: row.userId,
    subjectId: row.subjectId,
    topicKey: row.topicKey,
    topicId: row.topicId ?? null,
    level: row.level,
    computedAt: row.computedAt,
    computedByVersion: row.computedByVersion,
    contributingAssessmentIds: row.contributingAssessmentIds,
    schemaVersion: row.schemaVersion,
  };
}

export async function findMasteryState(
  db: Db,
  userId: string,
  subjectId: string,
  topicKey: string,
): Promise<MasteryState | null> {
  const [row] = await db
    .select()
    .from(masteryStates)
    .where(and(eq(masteryStates.userId, userId), eq(masteryStates.subjectId, subjectId), eq(masteryStates.topicKey, topicKey)))
    .limit(1);
  return row ? rowToMasteryState(row) : null;
}

/** Rollup (topicKey "") + every materialized per-topic row for this subject. */
export async function listMasteryStatesBySubject(db: Db, userId: string, subjectId: string): Promise<MasteryState[]> {
  const rows = await db
    .select()
    .from(masteryStates)
    .where(and(eq(masteryStates.userId, userId), eq(masteryStates.subjectId, subjectId)));
  return rows.map(rowToMasteryState);
}

/** Every `MasteryState` row, across all users/subjects — the decay sweep's input (B2 §1.5, §9.4). F2 scale: no pagination yet, flagged for architect review if row count grows past a single sweep's comfortable batch size. */
export async function listAllMasteryStates(db: Db): Promise<MasteryState[]> {
  const rows = await db.select().from(masteryStates);
  return rows.map(rowToMasteryState);
}

/** Chronological (oldest first) — matches the fold order §1.3 already assumes. */
export async function listMasteryHistoryByState(
  db: Db,
  userId: string,
  subjectId: string,
  topicKey: string,
): Promise<MasteryHistoryEntry[]> {
  const rows = await db
    .select()
    .from(masteryHistoryEntries)
    .where(
      and(
        eq(masteryHistoryEntries.userId, userId),
        eq(masteryHistoryEntries.subjectId, subjectId),
        eq(masteryHistoryEntries.topicKey, topicKey),
      ),
    )
    .orderBy(asc(masteryHistoryEntries.computedAt));
  return rows.map(rowToHistoryEntry);
}

/** Most recent first, across every scope of this subject — B4 inspect endpoint's "historial completo ordenado". */
export async function listMasteryHistoryBySubject(db: Db, userId: string, subjectId: string): Promise<MasteryHistoryEntry[]> {
  const rows = await db
    .select()
    .from(masteryHistoryEntries)
    .where(and(eq(masteryHistoryEntries.userId, userId), eq(masteryHistoryEntries.subjectId, subjectId)))
    .orderBy(desc(masteryHistoryEntries.computedAt));
  return rows.map(rowToHistoryEntry);
}

export interface WriteMasteryStateInput {
  userId: string;
  subjectId: string;
  topicKey: string;
  /** Optional UUID of the `Tema` this mastery row refers to. */
  topicId?: string | null;
  level: MasteryLevel;
  visibility: MasteryVisibility;
  computedByVersion: string;
  contributingAssessmentIds: string[];
}

export interface WriteMasteryStateResult {
  state: MasteryState;
  historyEntry: MasteryHistoryEntry;
}

/**
 * I-2: inserts a NEW `MasteryHistoryEntry` (append-only, I-3), then
 * upserts the `MasteryState` row for `(userId, subjectId, topicKey)`
 * (unique constraint, `mastery_states_user_subject_topic_unique`) to point
 * at it — both in one transaction, so no reader ever observes a
 * `MasteryState` whose `lastHistoryEntryId` doesn't resolve, or a history
 * entry with no corresponding state update.
 */
export async function writeMasteryState(db: Db, input: WriteMasteryStateInput): Promise<WriteMasteryStateResult> {
  return db.transaction(async (tx) => {
    const now = nowIso();

    const [entryRow] = await tx
      .insert(masteryHistoryEntries)
      .values({
        id: newId(),
        userId: input.userId,
        subjectId: input.subjectId,
        topicKey: input.topicKey,
        topicId: input.topicId ?? null,
        level: input.level,
        computedAt: now,
        computedByVersion: input.computedByVersion,
        contributingAssessmentIds: input.contributingAssessmentIds,
        schemaVersion: 1,
      })
      .returning();
    const historyEntry = rowToHistoryEntry(entryRow);

    const [stateRow] = await tx
      .insert(masteryStates)
      .values({
        id: newId(),
        userId: input.userId,
        subjectId: input.subjectId,
        topicKey: input.topicKey,
        topicId: input.topicId ?? null,
        currentLevel: input.level,
        visibility: input.visibility,
        lastHistoryEntryId: historyEntry.id,
        updatedAt: now,
        schemaVersion: 1,
      })
      .onConflictDoUpdate({
        target: [masteryStates.userId, masteryStates.subjectId, masteryStates.topicKey],
        set: {
          currentLevel: input.level,
          visibility: input.visibility,
          topicId: input.topicId ?? null,
          lastHistoryEntryId: historyEntry.id,
          updatedAt: now,
        },
      })
      .returning();
    const state = rowToMasteryState(stateRow);

    assertMasteryStateWrittenWithHistoryEntry(state, historyEntry);

    return { state, historyEntry };
  });
}
