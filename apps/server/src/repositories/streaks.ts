/**
 * Streak repository — B3 §2.11, B2 §1.7. ONE row per `(userId, kind)`.
 * Upsert pattern: read, compute in memory, then insert-or-update.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { streaks } from "../db/schema";
import type { Streak } from "@buxo/domain/gamification";
import { nowIso } from "./ids";

function rowToStreak(row: typeof streaks.$inferSelect): Streak {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    current: row.current,
    longest: row.longest,
    lastQualifyingAssessmentId: row.lastQualifyingAssessmentId,
    lastQualifyingAt: row.lastQualifyingAt,
    updatedAt: row.updatedAt,
    schemaVersion: row.schemaVersion,
  };
}

export async function findStreak(db: Db, userId: string): Promise<Streak | null> {
  const [row] = await db
    .select()
    .from(streaks)
    .where(and(eq(streaks.userId, userId), eq(streaks.kind, "assessment_approved")))
    .limit(1);
  return row ? rowToStreak(row) : null;
}

export async function upsertStreak(db: Db, streak: Streak): Promise<Streak> {
  const now = nowIso();
  const [row] = await db
    .insert(streaks)
    .values({
      id: streak.id,
      userId: streak.userId,
      kind: streak.kind,
      current: streak.current,
      longest: streak.longest,
      lastQualifyingAssessmentId: streak.lastQualifyingAssessmentId,
      lastQualifyingAt: streak.lastQualifyingAt,
      updatedAt: now,
      schemaVersion: 1,
    })
    .onConflictDoUpdate({
      target: [streaks.userId, streaks.kind],
      set: {
        current: streak.current,
        longest: streak.longest,
        lastQualifyingAssessmentId: streak.lastQualifyingAssessmentId,
        lastQualifyingAt: streak.lastQualifyingAt,
        updatedAt: now,
      },
    })
    .returning();
  return rowToStreak(row);
}
