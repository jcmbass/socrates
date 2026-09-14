/**
 * ChallengeDefinition repository — B3 §2.11, B2 §4.1. Read-only for the
 * gamification flow (definitions are seeded at migration time, not created
 * by users). `listActiveByScope` is the primary query: given a subjectId
 * and optional topicKey, returns all active definitions whose scope matches.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { challengeDefinitions } from "../db/schema";
import type { ChallengeDefinition } from "@buxo/domain/gamification";

function rowToDefinition(row: typeof challengeDefinitions.$inferSelect): ChallengeDefinition {
  return {
    id: row.id,
    scope: row.scope as ChallengeDefinition["scope"],
    titleKey: row.titleKey,
    descriptionKey: row.descriptionKey,
    version: row.version,
    criteria: row.criteria,
    active: row.active,
    createdAt: row.createdAt,
    schemaVersion: row.schemaVersion,
  };
}

/**
 * Returns all active ChallengeDefinitions whose scope matches the given
 * `(subjectId, topicKeyOrNull)`. For subject-scope definitions, matches
 * by subjectId. For topic-scope definitions, matches by subjectId + topicKey.
 * Generic-scope definitions are always returned (they are outside the
 * tier-driven flow but still need to be discoverable).
 */
export async function listActiveByScope(
  db: Db,
  subjectId: string,
  topicKeyOrNull: string | null,
): Promise<ChallengeDefinition[]> {
  const rows = await db
    .select()
    .from(challengeDefinitions)
    .where(and(eq(challengeDefinitions.active, true)));

  return rows
    .filter((r) => {
      const scope = r.scope as ChallengeDefinition["scope"];
      if (scope.kind === "generic") return true;
      if (scope.kind === "subject") return scope.subjectId === subjectId;
      if (scope.kind === "topic") return scope.subjectId === subjectId && scope.topicKey === topicKeyOrNull;
      return false;
    })
    .map(rowToDefinition);
}

/** All active definitions — used by the inspect endpoint. */
export async function listAllActive(db: Db): Promise<ChallengeDefinition[]> {
  const rows = await db
    .select()
    .from(challengeDefinitions)
    .where(eq(challengeDefinitions.active, true));
  return rows.map(rowToDefinition);
}
