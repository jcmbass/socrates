import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { studySessions } from "../db/schema";
import type { StudySession, BandChange, StudySessionKind, StudySessionStatus } from "@buxo/domain/study-session";
import type { Band } from "@buxo/core/prompts";
import type { MaterialAsset } from "@buxo/domain/material-asset";
import { newId, nowIso } from "./ids";
import { toMaterialEvent } from "../materials/events";

function rowToSession(row: typeof studySessions.$inferSelect): StudySession {
  return {
    id: row.id,
    userId: row.userId,
    subjectId: row.subjectId,
    subjectNameSnapshot: row.subjectNameSnapshot,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    status: row.status,
    kind: row.kind,
    topicId: row.topicId,
    milestoneId: row.milestoneId,
    previousSessionId: row.previousSessionId ?? null,
    initialBand: row.initialBand,
    materialAssetIds: row.materialAssetIds,
    materialSnapshotTextRef: row.materialSnapshotTextRef,
    materialSnapshotInfo: row.materialSnapshotInfo ?? null,
    bandChanges: row.bandChanges,
    materialEvents: row.materialEvents,
    schemaVersion: row.schemaVersion,
  };
}

export interface CreateStudySessionInput {
  userId: string;
  subjectId: string;
  subjectNameSnapshot: string;
  /** P5 — defaults to "topic" (every pre-P5 caller passes neither this nor topicId/milestoneId, which is exactly the legacy shape). */
  kind?: StudySessionKind;
  /** P5 (DF-P12) — the topic this session opened on, when `kind === "topic"`. */
  topicId?: string | null;
  /** P5 (DF-P05) — the Hito this session reviews, when `kind === "milestone"`. */
  milestoneId?: string | null;
  /** Plan-xp-progreso Fase 4 — prior closed session this new one reactivates. */
  previousSessionId?: string | null;
  initialBand: Band;
  materialAssetIds: string[];
  materialSnapshotTextRef: string | null;
  materialSnapshotInfo: { truncated: boolean; droppedTokens: number } | null;
  /**
   * The full MaterialAsset for each id in `materialAssetIds`, in the same
   * order (F2 WQ3 parte C1) — used ONLY to build the initial
   * `materialEvents` (one "added" event per material, timestamped with
   * this call's own `now`, same clock as `createdAt`/the initial
   * `BandChange`). Optional/defaults to `[]`: every direct repo test in
   * this codebase that predates this field passes `materialAssetIds: []`
   * too, so there's nothing to build events from.
   */
  materials?: MaterialAsset[];
}

export async function createStudySession(db: Db, input: CreateStudySessionInput): Promise<StudySession> {
  const now = nowIso();
  const initialBandChange: BandChange = { band: input.initialBand, timestamp: now, source: "initial", rationale: null };
  const materialEvents = (input.materials ?? []).map((m) => toMaterialEvent(m, "added", now));
  const [row] = await db
    .insert(studySessions)
    .values({
      id: newId(),
      userId: input.userId,
      subjectId: input.subjectId,
      subjectNameSnapshot: input.subjectNameSnapshot,
      createdAt: now,
      updatedAt: now,
      status: "active",
      kind: input.kind ?? "topic",
      topicId: input.topicId ?? null,
      milestoneId: input.milestoneId ?? null,
      previousSessionId: input.previousSessionId ?? null,
      initialBand: input.initialBand,
      materialAssetIds: input.materialAssetIds,
      materialSnapshotTextRef: input.materialSnapshotTextRef,
      materialSnapshotInfo: input.materialSnapshotInfo,
      bandChanges: [initialBandChange],
      materialEvents,
      schemaVersion: 1,
    })
    .returning();
  return rowToSession(row);
}

export async function findStudySessionById(db: Db, userId: string, id: string): Promise<StudySession | null> {
  const [row] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, id), eq(studySessions.userId, userId)))
    .limit(1);
  return row ? rowToSession(row) : null;
}

export async function listAllStudySessionsByUser(db: Db, userId: string): Promise<StudySession[]> {
  const rows = await db.select().from(studySessions).where(eq(studySessions.userId, userId));
  return rows.map(rowToSession);
}

export async function listActiveStudySessions(db: Db, userId: string): Promise<StudySession[]> {
  const rows = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.userId, userId), eq(studySessions.status, "active")));
  return rows.map(rowToSession);
}

/** Current effective band = last entry of bandChanges (append-only value object array). */
export function currentBand(session: StudySession): Band {
  const last = session.bandChanges[session.bandChanges.length - 1];
  return last?.band ?? session.initialBand;
}

export async function appendBandChange(db: Db, sessionId: string, change: BandChange): Promise<StudySession> {
  const [existing] = await db.select().from(studySessions).where(eq(studySessions.id, sessionId)).limit(1);
  if (!existing) throw new Error(`StudySession ${sessionId} not found`);
  const bandChanges = [...existing.bandChanges, change];
  const [row] = await db
    .update(studySessions)
    .set({ bandChanges, updatedAt: nowIso() })
    .where(eq(studySessions.id, sessionId))
    .returning();
  return rowToSession(row);
}

export async function touchStudySession(db: Db, sessionId: string): Promise<void> {
  await db.update(studySessions).set({ updatedAt: nowIso() }).where(eq(studySessions.id, sessionId));
}

/**
 * Mid-session material attach (F2 WQ2 Part 2, `routes/sessions.ts`'s
 * `POST /:id/materials` — see that file's module doc "DEVIATION #2"):
 * replaces `materialAssetIds` and the derived snapshot fields wholesale —
 * the caller has already recomputed both (`../materials/snapshot.ts`)
 * against the FULL updated list, so this is a plain overwrite, not a
 * merge.
 *
 * `newMaterial` (F2 WQ3 parte C1), when given, becomes one "added"
 * `MaterialEvent` APPENDED to the existing `materialEvents` array in this
 * SAME `update` — one query, so `materialAssetIds` and `materialEvents`
 * can never drift apart (the invariant the architect's mandate called
 * for). Optional only so a caller re-attaching an already-present material
 * (the route's idempotent no-op branch, which returns early and never
 * reaches this function) has a well-typed way to skip it — every real
 * call site today passes one.
 */
export async function attachMaterialToSession(
  db: Db,
  sessionId: string,
  materialAssetIds: string[],
  snapshot: { materialSnapshotTextRef: string | null; materialSnapshotInfo: { truncated: boolean; droppedTokens: number } | null },
  newMaterial?: MaterialAsset,
): Promise<StudySession> {
  const [existing] = await db.select().from(studySessions).where(eq(studySessions.id, sessionId)).limit(1);
  if (!existing) throw new Error(`StudySession ${sessionId} not found`);
  const now = nowIso();
  const materialEvents = newMaterial ? [...existing.materialEvents, toMaterialEvent(newMaterial, "added", now)] : existing.materialEvents;
  const [row] = await db
    .update(studySessions)
    .set({
      materialAssetIds,
      materialSnapshotTextRef: snapshot.materialSnapshotTextRef,
      materialSnapshotInfo: snapshot.materialSnapshotInfo,
      materialEvents,
      updatedAt: now,
    })
    .where(eq(studySessions.id, sessionId))
    .returning();
  return rowToSession(row);
}

/**
 * Most recent closed (completed|abandoned) session for the same user+topic,
 * used to link a reactivation (plan-xp-progreso Fase 4: new session, not resume).
 */
export async function findMostRecentClosedSessionForTopic(
  db: Db,
  userId: string,
  topicId: string,
): Promise<StudySession | null> {
  const [row] = await db
    .select()
    .from(studySessions)
    .where(
      and(
        eq(studySessions.userId, userId),
        eq(studySessions.topicId, topicId),
        inArray(studySessions.status, ["completed", "abandoned"]),
      ),
    )
    .orderBy(desc(studySessions.updatedAt))
    .limit(1);
  return row ? rowToSession(row) : null;
}

/** Close a single session (status must currently be active). */
export async function closeStudySession(
  db: Db,
  sessionId: string,
  status: Exclude<StudySessionStatus, "active">,
): Promise<StudySession | null> {
  const [row] = await db
    .update(studySessions)
    .set({ status, updatedAt: nowIso() })
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.status, "active")))
    .returning();
  return row ? rowToSession(row) : null;
}

/**
 * Plan-xp-progreso Fase 4 — mark active sessions whose `updatedAt` is older
 * than `cutoffIso` as `abandoned`. Returns how many rows flipped.
 */
export async function abandonInactiveStudySessions(db: Db, cutoffIso: string): Promise<number> {
  const rows = await db
    .update(studySessions)
    .set({ status: "abandoned", updatedAt: nowIso() })
    .where(and(eq(studySessions.status, "active"), lt(studySessions.updatedAt, cutoffIso)))
    .returning({ id: studySessions.id });
  return rows.length;
}
