/**
 * session_openings — one tutor opening per study session, never an Exchange.
 *
 * A `generating` row is the claim taken BEFORE the model call. Concurrent
 * POSTs see in-flight and wait (or reclaim if stale). `ready` is the
 * persisted opening returned to clients.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { sessionOpenings } from "../db/schema";
import {
  parseSessionOpeningGrounding,
  SessionOpeningSchema,
  type SessionOpening,
  type SessionOpeningGrounding,
} from "@buxo/domain/session-opening";
import { newId, nowIso } from "./ids";

/** Holgado contra un stream de apertura lento; reclaim after crash. */
export const OPENING_CLAIM_ORPHAN_MS = 2 * 60 * 1000;
export const OPENING_IN_FLIGHT_POLL_MS = 25;
export const OPENING_IN_FLIGHT_TIMEOUT_MS = 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rowToOpening(row: typeof sessionOpenings.$inferSelect): SessionOpening {
  const grounding = parseSessionOpeningGrounding(row.grounding);
  if (!grounding) {
    throw new Error(`session_opening ${row.id} has invalid grounding`);
  }
  const parsed = SessionOpeningSchema.safeParse({
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    text: row.text,
    tutorPromptVersion: row.tutorPromptVersion,
    tutorModelId: row.tutorModelId,
    tutorProviderId: row.tutorProviderId,
    grounding,
    createdAt: row.createdAt,
    schemaVersion: row.schemaVersion,
  });
  if (!parsed.success) {
    throw new Error(`session_opening ${row.id} failed domain validation`);
  }
  return parsed.data;
}

function isReadyRow(row: typeof sessionOpenings.$inferSelect): boolean {
  return row.status === "ready" && typeof row.text === "string" && row.text.trim().length > 0;
}

export async function findReadySessionOpeningBySessionId(
  db: Db,
  sessionId: string,
): Promise<SessionOpening | null> {
  const [row] = await db.select().from(sessionOpenings).where(eq(sessionOpenings.sessionId, sessionId)).limit(1);
  if (!row || !isReadyRow(row)) return null;
  return rowToOpening(row);
}

/** @deprecated use findReadySessionOpeningBySessionId — generating rows are not client-visible. */
export async function findSessionOpeningBySessionId(db: Db, sessionId: string): Promise<SessionOpening | null> {
  return findReadySessionOpeningBySessionId(db, sessionId);
}

export async function listReadySessionOpeningsBySessionIds(
  db: Db,
  sessionIds: readonly string[],
): Promise<SessionOpening[]> {
  if (sessionIds.length === 0) return [];
  const rows = await db.select().from(sessionOpenings).where(inArray(sessionOpenings.sessionId, [...sessionIds]));
  return rows.filter(isReadyRow).map(rowToOpening);
}

export interface CreateSessionOpeningInput {
  sessionId: string;
  userId: string;
  text: string;
  tutorPromptVersion: string;
  tutorModelId: string;
  tutorProviderId: string;
  grounding: SessionOpeningGrounding;
}

/**
 * Insert a ready opening. Unique-index race re-reads the winner.
 * `inserted` is false when this caller lost the race — do not charge quota.
 */
export async function createSessionOpening(
  db: Db,
  input: CreateSessionOpeningInput,
): Promise<{ opening: SessionOpening; inserted: boolean }> {
  const createdAt = nowIso();
  try {
    const [row] = await db
      .insert(sessionOpenings)
      .values({
        id: newId(),
        sessionId: input.sessionId,
        userId: input.userId,
        text: input.text,
        tutorPromptVersion: input.tutorPromptVersion,
        tutorModelId: input.tutorModelId,
        tutorProviderId: input.tutorProviderId,
        grounding: input.grounding,
        status: "ready",
        claimedAt: createdAt,
        createdAt,
        schemaVersion: 1,
      })
      .returning();
    return { opening: rowToOpening(row), inserted: true };
  } catch (err) {
    const raced = await findReadySessionOpeningBySessionId(db, input.sessionId);
    if (raced) return { opening: raced, inserted: false };
    throw err;
  }
}

export type ClaimOpeningResult =
  | { kind: "ready"; opening: SessionOpening }
  | { kind: "acquired"; claimId: string }
  | { kind: "in_flight" };

/**
 * Atomically claim generation for a session BEFORE the model call.
 * Stale `generating` rows (crash) are reclaimed in the same UPSERT.
 */
export async function claimSessionOpeningGeneration(
  db: Db,
  input: { sessionId: string; userId: string; now: Date },
): Promise<ClaimOpeningResult> {
  const claimedAt = input.now.toISOString();
  const orphanCutoff = new Date(input.now.getTime() - OPENING_CLAIM_ORPHAN_MS).toISOString();
  const claimId = newId();

  const upserted = await db
    .insert(sessionOpenings)
    .values({
      id: claimId,
      sessionId: input.sessionId,
      userId: input.userId,
      text: null,
      tutorModelId: null,
      tutorProviderId: null,
      tutorPromptVersion: null,
      grounding: null,
      status: "generating",
      claimedAt,
      createdAt: claimedAt,
      schemaVersion: 1,
    })
    .onConflictDoUpdate({
      target: sessionOpenings.sessionId,
      set: {
        id: claimId,
        userId: input.userId,
        text: null,
        tutorModelId: null,
        tutorProviderId: null,
        tutorPromptVersion: null,
        grounding: null,
        status: "generating",
        claimedAt,
      },
      setWhere: and(
        eq(sessionOpenings.status, "generating"),
        sql`${sessionOpenings.claimedAt} < ${orphanCutoff}`,
      ),
    })
    .returning();

  if (upserted[0]?.status === "generating" && upserted[0].id === claimId) {
    return { kind: "acquired", claimId };
  }

  const [existing] = await db
    .select()
    .from(sessionOpenings)
    .where(eq(sessionOpenings.sessionId, input.sessionId))
    .limit(1);

  if (existing && isReadyRow(existing)) {
    return { kind: "ready", opening: rowToOpening(existing) };
  }
  if (existing && existing.status === "generating") {
    return { kind: "in_flight" };
  }
  return { kind: "in_flight" };
}

export async function completeSessionOpeningGeneration(
  db: Db,
  input: {
    sessionId: string;
    claimId: string;
    text: string;
    tutorPromptVersion: string;
    tutorModelId: string;
    tutorProviderId: string;
    grounding: SessionOpeningGrounding;
  },
): Promise<{ opening: SessionOpening; completed: boolean }> {
  const [row] = await db
    .update(sessionOpenings)
    .set({
      text: input.text,
      tutorPromptVersion: input.tutorPromptVersion,
      tutorModelId: input.tutorModelId,
      tutorProviderId: input.tutorProviderId,
      grounding: input.grounding,
      status: "ready",
    })
    .where(
      and(
        eq(sessionOpenings.sessionId, input.sessionId),
        eq(sessionOpenings.id, input.claimId),
        eq(sessionOpenings.status, "generating"),
      ),
    )
    .returning();

  if (row && isReadyRow(row)) {
    return { opening: rowToOpening(row), completed: true };
  }
  const ready = await findReadySessionOpeningBySessionId(db, input.sessionId);
  if (ready) return { opening: ready, completed: false };
  throw new Error("opening claim lost and no ready row");
}

/** Drop a generating claim that will not become an opening (quota/exchanges/tutor failure). */
export async function releaseSessionOpeningClaim(
  db: Db,
  input: { sessionId: string; claimId: string },
): Promise<void> {
  await db
    .delete(sessionOpenings)
    .where(
      and(
        eq(sessionOpenings.sessionId, input.sessionId),
        eq(sessionOpenings.id, input.claimId),
        eq(sessionOpenings.status, "generating"),
      ),
    );
}

export async function waitForReadySessionOpening(
  db: Db,
  sessionId: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<SessionOpening | null> {
  const timeoutMs = opts?.timeoutMs ?? OPENING_IN_FLIGHT_TIMEOUT_MS;
  const intervalMs = opts?.intervalMs ?? OPENING_IN_FLIGHT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await findReadySessionOpeningBySessionId(db, sessionId);
    if (ready) return ready;
    const [row] = await db
      .select({ status: sessionOpenings.status, claimedAt: sessionOpenings.claimedAt })
      .from(sessionOpenings)
      .where(eq(sessionOpenings.sessionId, sessionId))
      .limit(1);
    if (!row) return null;
    await sleep(intervalMs);
  }
  return findReadySessionOpeningBySessionId(db, sessionId);
}
