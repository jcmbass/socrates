/**
 * Achievement repository — B3 §2.11, B2 §4.2-§4.3. Append-only: rows are
 * never updated or deleted (I-11: NUNCA se reescribe la fila anterior).
 * A revoked achievement gets a NEW row with `status: "revoked"` and
 * `revokedAt` set; the original earned row is never touched.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { achievements } from "../db/schema";
import type { Achievement } from "@buxo/domain/gamification";
import { newId, nowIso } from "./ids";

function rowToAchievement(row: typeof achievements.$inferSelect): Achievement {
  return {
    id: row.id,
    userId: row.userId,
    challengeDefinitionId: row.challengeDefinitionId,
    challengeDefinitionVersion: row.challengeDefinitionVersion,
    subjectId: row.subjectId,
    topicKey: row.topicKey,
    earnedAt: row.earnedAt,
    status: row.status,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    evidenceAssessmentIds: row.evidenceAssessmentIds,
    retryOf: row.retryOf,
    schemaVersion: row.schemaVersion,
  };
}

export interface NewAchievementRow {
  userId: string;
  challengeDefinitionId: string;
  challengeDefinitionVersion: string;
  subjectId: string;
  topicKey: string | null;
  evidenceAssessmentIds: string[];
  retryOf: string | null;
}

/**
 * Inserts a new earned Achievement row. Returns the created row.
 * The caller is responsible for resolving the I-11 retry linkage
 * (looking up a prior revoked Achievement for the same
 * `(userId, challengeDefinitionId, scope)` and setting `retryOf`).
 */
export async function insertAchievement(db: Db, input: NewAchievementRow): Promise<Achievement> {
  const now = nowIso();
  const [row] = await db
    .insert(achievements)
    .values({
      id: newId(),
      userId: input.userId,
      challengeDefinitionId: input.challengeDefinitionId,
      challengeDefinitionVersion: input.challengeDefinitionVersion,
      subjectId: input.subjectId,
      topicKey: input.topicKey,
      earnedAt: now,
      status: "earned",
      revokedAt: null,
      revokedReason: null,
      evidenceAssessmentIds: input.evidenceAssessmentIds,
      retryOf: input.retryOf,
      schemaVersion: 1,
    })
    .returning();
  return rowToAchievement(row);
}

/**
 * Returns all Achievement rows for a given `(userId, subjectId)`.
 * Used by `maybeAwardAchievements` for idempotency checks and by
 * the inspect endpoint.
 */
export async function listByUserAndSubject(
  db: Db,
  userId: string,
  subjectId: string,
): Promise<Achievement[]> {
  const rows = await db
    .select()
    .from(achievements)
    .where(and(eq(achievements.userId, userId), eq(achievements.subjectId, subjectId)));
  return rows.map(rowToAchievement);
}

/**
 * Finds a prior revoked Achievement for the same
 * `(userId, challengeDefinitionId, scope)` — used to resolve the I-11
 * retry linkage. Returns null if no such revoked row exists.
 */
export async function findRevokedForRetry(
  db: Db,
  userId: string,
  challengeDefinitionId: string,
  subjectId: string,
  topicKey: string | null,
): Promise<Achievement | null> {
  const rows = await db
    .select()
    .from(achievements)
    .where(
      and(
        eq(achievements.userId, userId),
        eq(achievements.challengeDefinitionId, challengeDefinitionId),
        eq(achievements.subjectId, subjectId),
        topicKey === null
          ? isNull(achievements.topicKey)
          : eq(achievements.topicKey, topicKey),
        eq(achievements.status, "revoked"),
      ),
    )
    .limit(1);
  return rows.length > 0 ? rowToAchievement(rows[0]) : null;
}
