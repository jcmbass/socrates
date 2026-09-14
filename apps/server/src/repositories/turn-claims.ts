/**
 * Turn idempotency claims — beta-real 10.
 *
 * Claim `(sessionId, clientMessageId)` BEFORE the tutor runs. Completing
 * `exchangeId` happens when the Exchange is persisted. Orphan claims
 * (no exchange, older than TURN_CLAIM_ORPHAN_MS) are reclaimable in the
 * SAME atomic INSERT … ON CONFLICT that performs a fresh claim — a prior
 * SELECT would reintroduce the race this table exists to kill.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { turnClaims } from "../db/schema";

/** Holgado contra el techo real de un turno (plan 10 §3.3). */
export const TURN_CLAIM_ORPHAN_MS = 10 * 60 * 1000;

export type TurnClaimRow = {
  sessionId: string;
  clientMessageId: string;
  exchangeId: string | null;
  createdAt: string;
};

export type ClaimTurnResult =
  | { kind: "acquired"; claim: TurnClaimRow }
  | { kind: "duplicate"; claim: TurnClaimRow };

function rowFrom(row: typeof turnClaims.$inferSelect): TurnClaimRow {
  return {
    sessionId: row.sessionId,
    clientMessageId: row.clientMessageId,
    exchangeId: row.exchangeId,
    createdAt: row.createdAt,
  };
}

/**
 * Atomically claim a client message id for a session.
 *
 * - Insert succeeds → acquired.
 * - Conflict on an orphan (no exchange_id, created_at older than cutoff) →
 *   reclaim via ON CONFLICT DO UPDATE … WHERE, acquired.
 * - Conflict on an in-flight or completed claim → duplicate (RETURNING empty;
 *   then SELECT the existing row).
 */
export async function claimTurn(
  db: Db,
  input: { sessionId: string; clientMessageId: string; now: Date },
): Promise<ClaimTurnResult> {
  const createdAt = input.now.toISOString();
  const orphanCutoff = new Date(input.now.getTime() - TURN_CLAIM_ORPHAN_MS).toISOString();

  const inserted = await db
    .insert(turnClaims)
    .values({
      sessionId: input.sessionId,
      clientMessageId: input.clientMessageId,
      exchangeId: null,
      createdAt,
    })
    .onConflictDoUpdate({
      target: [turnClaims.sessionId, turnClaims.clientMessageId],
      set: {
        createdAt,
        exchangeId: null,
      },
      setWhere: and(sql`${turnClaims.exchangeId} IS NULL`, sql`${turnClaims.createdAt} < ${orphanCutoff}`),
    })
    .returning();

  if (inserted[0]) {
    return { kind: "acquired", claim: rowFrom(inserted[0]) };
  }

  const [existing] = await db
    .select()
    .from(turnClaims)
    .where(
      and(eq(turnClaims.sessionId, input.sessionId), eq(turnClaims.clientMessageId, input.clientMessageId)),
    )
    .limit(1);

  if (!existing) {
    // Extremely unlikely: conflict with empty RETURNING but row vanished.
    // Treat as acquired by re-inserting without conflict handling.
    const [retry] = await db
      .insert(turnClaims)
      .values({
        sessionId: input.sessionId,
        clientMessageId: input.clientMessageId,
        exchangeId: null,
        createdAt,
      })
      .returning();
    return { kind: "acquired", claim: rowFrom(retry) };
  }

  return { kind: "duplicate", claim: rowFrom(existing) };
}

/** Drop a claim that never produced an Exchange (quota/safety/tutor failure before stream). */
export async function releaseTurnClaim(
  db: Db,
  input: { sessionId: string; clientMessageId: string },
): Promise<void> {
  await db
    .delete(turnClaims)
    .where(
      and(
        eq(turnClaims.sessionId, input.sessionId),
        eq(turnClaims.clientMessageId, input.clientMessageId),
        sql`${turnClaims.exchangeId} IS NULL`,
      ),
    );
}

/** Bind the persisted Exchange to the claim once the stream finished (I-12). */
export async function completeTurnClaim(
  db: Db,
  input: { sessionId: string; clientMessageId: string; exchangeId: string },
): Promise<void> {
  await db
    .update(turnClaims)
    .set({ exchangeId: input.exchangeId })
    .where(
      and(eq(turnClaims.sessionId, input.sessionId), eq(turnClaims.clientMessageId, input.clientMessageId)),
    );
}
