import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { issueMagicLink, verifyMagicLink } from "../../src/auth/magic-link";

describe("magic-link issue/verify (DF-6.2)", () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("issues a token and verifies it successfully", async () => {
    const now = new Date("2026-07-12T12:00:00Z");
    const { token } = await issueMagicLink(testDb.db, { email: "ana@example.com", purpose: "login", userId: "u1", ttlMinutes: 20, now });

    const result = await verifyMagicLink(testDb.db, token, now);
    expect(result).toMatchObject({ ok: true, email: "ana@example.com", purpose: "login", userId: "u1" });
  });

  it("rejects an unknown token", async () => {
    const result = await verifyMagicLink(testDb.db, "not-a-real-token");
    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });

  it("rejects an expired token", async () => {
    const now = new Date("2026-07-12T12:00:00Z");
    const { token } = await issueMagicLink(testDb.db, { email: "b@example.com", purpose: "login", userId: "u2", ttlMinutes: 20, now });

    const later = new Date(now.getTime() + 21 * 60_000);
    const result = await verifyMagicLink(testDb.db, token, later);
    expect(result).toEqual({ ok: false, error: "token_expired" });
  });

  it("accepts a token right up to (but not past) its TTL", async () => {
    const now = new Date("2026-07-12T12:00:00Z");
    const { token } = await issueMagicLink(testDb.db, { email: "c@example.com", purpose: "login", userId: "u3", ttlMinutes: 20, now });

    const justBefore = new Date(now.getTime() + 20 * 60_000 - 1);
    const result = await verifyMagicLink(testDb.db, token, justBefore);
    expect(result.ok).toBe(true);
  });

  it("rejects reuse of an already-consumed token", async () => {
    const now = new Date("2026-07-12T12:00:00Z");
    const { token } = await issueMagicLink(testDb.db, { email: "d@example.com", purpose: "signup", ttlMinutes: 20, now });

    const first = await verifyMagicLink(testDb.db, token, now);
    expect(first.ok).toBe(true);

    const second = await verifyMagicLink(testDb.db, token, now);
    expect(second).toEqual({ ok: false, error: "token_already_used" });
  });

  it("carries the signup payload through to verification", async () => {
    const now = new Date();
    const payload = { displayName: "Ana", ageConfirmedAt: now.toISOString(), consents: [{ type: "terms_13plus", policyVersion: "v1" }] };
    const { token } = await issueMagicLink(testDb.db, { email: "e@example.com", purpose: "signup", payload, ttlMinutes: 20, now });

    const result = await verifyMagicLink(testDb.db, token, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual(payload);
    }
  });

  it("never stores the raw token — only its hash is persisted", async () => {
    const now = new Date();
    const { token } = await issueMagicLink(testDb.db, { email: "f@example.com", purpose: "login", userId: "u4", ttlMinutes: 20, now });

    const { magicLinkTokens } = await import("../../src/db/schema");
    const rows = await testDb.db.select().from(magicLinkTokens);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
    expect(rows.every((r) => r.tokenHash.length === 64)).toBe(true); // sha256 hex
  });
});
