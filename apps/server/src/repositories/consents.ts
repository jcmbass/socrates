import { eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Db } from "../db/client";
import { consents } from "../db/schema";
import type { Consent, ConsentType } from "@buxo/domain/consent";
import { newId, nowIso } from "./ids";

function rowToConsent(row: typeof consents.$inferSelect): Consent {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    status: row.status,
    policyVersion: row.policyVersion,
    occurredAt: row.occurredAt,
    schemaVersion: row.schemaVersion,
  };
}

export interface AcceptConsentInput {
  userId: string;
  type: ConsentType;
  policyVersion: string;
}

/** I-6: append-only — always INSERTs, never UPDATEs an existing row. */
export async function acceptConsent(db: Db, input: AcceptConsentInput): Promise<Consent> {
  const [row] = await db
    .insert(consents)
    .values({
      id: newId(),
      userId: input.userId,
      type: input.type,
      status: "accepted",
      policyVersion: input.policyVersion,
      occurredAt: nowIso(),
      schemaVersion: 1,
    })
    .returning();
  return rowToConsent(row);
}

export async function listConsentsByUser(db: Db, userId: string): Promise<Consent[]> {
  const rows = await db.select().from(consents).where(eq(consents.userId, userId));
  return rows.map(rowToConsent);
}

/**
 * C-backend §5.3 response to R-8: on account deletion, `Consent` rows are
 * NEVER purged (they are buxo's evidence of DF-3 age-confirmation
 * compliance) — instead `userId` is rewritten to a salted, one-way
 * pseudonym. `salt` should be a server-side secret (JWT_SECRET is reused
 * here rather than adding a second secret env var — both are "server-only
 * HMAC-adjacent keys", acceptable to share for this MVP mechanism; a real
 * deployment might split them).
 */
export async function pseudonymizeConsentsForUser(db: Db, userId: string, salt: string): Promise<number> {
  const pseudonym = `pseudo_${createHash("sha256").update(`${salt}:${userId}`).digest("hex")}`;
  const result = await db
    .update(consents)
    .set({ userId: pseudonym })
    .where(eq(consents.userId, userId))
    .returning({ id: consents.id });
  return result.length;
}

export async function countConsents(db: Db): Promise<number> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(consents);
  return count;
}
