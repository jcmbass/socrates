/**
 * Magic-link issuance/verification — DF-6.2 ("auth self-hosted ... sobre
 * Postgres"). The raw token is only ever held in memory (returned to the
 * caller to build the link / send the email) and never persisted; only its
 * SHA-256 hash is stored, so a DB read (backup leak, etc.) cannot be turned
 * back into a usable token.
 */
import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { magicLinkTokens } from "../db/schema";
import { newId } from "../repositories/ids";

export type MagicLinkPurpose = "signup" | "login";

export interface SignupPayload {
  displayName: string;
  ageConfirmedAt: string;
  consents: Array<{ type: string; policyVersion: string }>;
  countryCode?: string;
  preferredLanguageCode?: string;
}

export interface IssueMagicLinkInput {
  email: string;
  purpose: MagicLinkPurpose;
  userId?: string | null;
  payload?: SignupPayload | null;
  ttlMinutes: number;
  now?: Date;
}

export interface IssuedMagicLink {
  token: string;
  expiresAt: string;
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueMagicLink(db: Db, input: IssueMagicLinkInput): Promise<IssuedMagicLink> {
  const now = input.now ?? new Date();
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + input.ttlMinutes * 60_000).toISOString();

  await db.insert(magicLinkTokens).values({
    id: newId(),
    tokenHash: hashToken(token),
    email: input.email.toLowerCase(),
    purpose: input.purpose,
    userId: input.userId ?? null,
    payload: (input.payload as unknown as Record<string, unknown>) ?? null,
    createdAt: now.toISOString(),
    expiresAt,
    consumedAt: null,
  });

  return { token, expiresAt };
}

export type VerifyMagicLinkError = "invalid_token" | "token_expired" | "token_already_used";

export type VerifyMagicLinkResult =
  | {
      ok: true;
      email: string;
      purpose: MagicLinkPurpose;
      userId: string | null;
      payload: SignupPayload | null;
    }
  | { ok: false; error: VerifyMagicLinkError };

export async function verifyMagicLink(db: Db, token: string, now: Date = new Date()): Promise<VerifyMagicLinkResult> {
  const tokenHash = hashToken(token);
  const [row] = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, tokenHash)).limit(1);

  if (!row) return { ok: false, error: "invalid_token" };
  if (row.consumedAt !== null) return { ok: false, error: "token_already_used" };
  if (new Date(row.expiresAt).getTime() < now.getTime()) return { ok: false, error: "token_expired" };

  await db.update(magicLinkTokens).set({ consumedAt: now.toISOString() }).where(eq(magicLinkTokens.id, row.id));

  return {
    ok: true,
    email: row.email,
    purpose: row.purpose,
    userId: row.userId,
    payload: (row.payload as SignupPayload | null) ?? null,
  };
}
