import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import type { User, AuthIdentifier, AccountKind } from "@buxo/domain/user";
import { newId, nowIso } from "./ids";

function rowToUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    schemaVersion: row.schemaVersion,
    displayName: row.displayName,
    authIdentifiers: row.authIdentifiers,
    countryCode: row.countryCode,
    preferredLanguageCode: row.preferredLanguageCode,
    ageConfirmedAt: row.ageConfirmedAt,
    birthYear: row.birthYear,
    currentCourseId: row.currentCourseId,
    accountStatus: row.accountStatus,
    deletedAt: row.deletedAt,
    accountKind: row.accountKind,
    onboardingCompletedAt: row.onboardingCompletedAt,
  };
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  ageConfirmedAt: string;
  countryCode?: string;
  preferredLanguageCode?: string;
  accountKind?: AccountKind;
}

export async function createUser(db: Db, input: CreateUserInput): Promise<User> {
  const now = nowIso();
  const authIdentifiers: AuthIdentifier[] = [
    { type: "email", value: input.email, verifiedAt: now, isPrimary: true },
  ];
  const [row] = await db
    .insert(users)
    .values({
      id: newId(),
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
      displayName: input.displayName,
      authIdentifiers,
      primaryEmail: input.email.toLowerCase(),
      countryCode: input.countryCode ?? "SV",
      preferredLanguageCode: input.preferredLanguageCode ?? "es",
      ageConfirmedAt: input.ageConfirmedAt,
      birthYear: null,
      currentCourseId: null,
      accountStatus: "active",
      deletedAt: null,
      accountKind: input.accountKind ?? "student",
    })
    .returning();
  return rowToUser(row);
}

export async function findUserByEmail(db: Db, email: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.primaryEmail, email.toLowerCase())).limit(1);
  return row ? rowToUser(row) : null;
}

export async function findUserById(db: Db, id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ? rowToUser(row) : null;
}

/**
 * A3a — persist the student's effective UI locale (PATCH /v1/me). The value
 * is already validated upstream ("es" | "en", routes/me.ts); this stays a
 * plain typed write so the invariant lives in one place. Idempotent: writing
 * the same value twice leaves the same row state (only `updatedAt` moves).
 */
export async function setPreferredLanguage(
  db: Db,
  userId: string,
  preferredLanguageCode: "es" | "en",
): Promise<void> {
  await db
    .update(users)
    .set({ preferredLanguageCode, updatedAt: nowIso() })
    .where(eq(users.id, userId));
}

/**
 * D-C07 — seal the onboarding flag (`PATCH /v1/me { onboardingCompleted: true }`).
 * Idempotent in the sense that matters (the flag stays truthy once set);
 * a repeated call still advances the timestamp, which is harmless since no
 * reader depends on the ORIGINAL sealing instant, only on "is it non-null".
 */
export async function markOnboardingCompleted(db: Db, userId: string): Promise<void> {
  await db.update(users).set({ onboardingCompletedAt: nowIso(), updatedAt: nowIso() }).where(eq(users.id, userId));
}

export async function setCurrentCourse(db: Db, userId: string, courseId: string): Promise<void> {
  await db.update(users).set({ currentCourseId: courseId, updatedAt: nowIso() }).where(eq(users.id, userId));
}

/** C5 §5.3 tombstone: soft-delete + timestamp. Consent pseudonymization is a separate call (repositories/consents.ts). */
export async function markUserDeleted(db: Db, userId: string): Promise<void> {
  const now = nowIso();
  await db
    .update(users)
    .set({ accountStatus: "deleted", deletedAt: now, updatedAt: now })
    .where(eq(users.id, userId));
}
