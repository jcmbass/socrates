/**
 * Turn claim repository — orphan reclaim must be atomic (beta-real 10 §3.3).
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { exchanges, turnClaims } from "../../src/db/schema";
import {
  claimTurn,
  completeTurnClaim,
  releaseTurnClaim,
  TURN_CLAIM_ORPHAN_MS,
} from "../../src/repositories/turn-claims";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import { createStudySession } from "../../src/repositories/study-sessions";
import { newId, nowIso } from "../../src/repositories/ids";

async function seedSession(db: TestDb["db"]) {
  const user = await createUser(db, {
    email: `claims-${newId()}@example.com`,
    displayName: "Ana",
    ageConfirmedAt: new Date().toISOString(),
  });
  const course = await createCourse(db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
  const subject = await createSubject(db, { userId: user.id, courseId: course.id, name: "Cálculo" });
  const session = await createStudySession(db, {
    userId: user.id,
    subjectId: subject.id,
    subjectNameSnapshot: subject.name,
    initialBand: "guiding",
    materialAssetIds: [],
    materialSnapshotTextRef: null,
    materialSnapshotInfo: null,
  });
  return { sessionId: session.id };
}

describe("claimTurn — atomic idempotency (beta-real 10)", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  it("acquires a fresh claim", async () => {
    testDb = await createTestDb();
    const { sessionId } = await seedSession(testDb.db);
    const now = new Date("2026-07-29T12:00:00.000Z");
    const result = await claimTurn(testDb.db, { sessionId, clientMessageId: "cm-1", now });
    expect(result.kind).toBe("acquired");
  });

  it("second claim with the same id is a duplicate (in-flight)", async () => {
    testDb = await createTestDb();
    const { sessionId } = await seedSession(testDb.db);
    const now = new Date("2026-07-29T12:00:00.000Z");
    await claimTurn(testDb.db, { sessionId, clientMessageId: "cm-1", now });
    const dup = await claimTurn(testDb.db, { sessionId, clientMessageId: "cm-1", now });
    expect(dup.kind).toBe("duplicate");
    if (dup.kind === "duplicate") expect(dup.claim.exchangeId).toBeNull();
  });

  it("completed claim is still a duplicate", async () => {
    testDb = await createTestDb();
    const { sessionId } = await seedSession(testDb.db);
    const now = new Date("2026-07-29T12:00:00.000Z");
    await claimTurn(testDb.db, { sessionId, clientMessageId: "cm-1", now });
    const exchangeId = newId();
    await testDb.db.insert(exchanges).values({
      id: exchangeId,
      sessionId,
      index_: 0,
      timestamp: nowIso(),
      studentMessage: "hola",
      tutorReply: "¿qué pensás?",
      band: "guiding",
      tutorPromptVersion: "v1",
      tutorModelId: "fake",
      tutorProviderId: "fake",
      schemaVersion: 1,
    });
    await completeTurnClaim(testDb.db, { sessionId, clientMessageId: "cm-1", exchangeId });
    const dup = await claimTurn(testDb.db, { sessionId, clientMessageId: "cm-1", now });
    expect(dup.kind).toBe("duplicate");
    if (dup.kind === "duplicate") expect(dup.claim.exchangeId).toBe(exchangeId);
  });

  it("orphan claim older than threshold can be reclaimed atomically", async () => {
    testDb = await createTestDb();
    const { sessionId } = await seedSession(testDb.db);
    const firstNow = new Date("2026-07-29T12:00:00.000Z");
    await claimTurn(testDb.db, { sessionId, clientMessageId: "cm-orphan", now: firstNow });

    const later = new Date(firstNow.getTime() + TURN_CLAIM_ORPHAN_MS + 1_000);
    const reclaim = await claimTurn(testDb.db, { sessionId, clientMessageId: "cm-orphan", now: later });
    expect(reclaim.kind).toBe("acquired");
    if (reclaim.kind === "acquired") {
      expect(reclaim.claim.exchangeId).toBeNull();
      expect(reclaim.claim.createdAt).toBe(later.toISOString());
    }
  });

  it("releaseTurnClaim frees an in-flight claim so it can be acquired again", async () => {
    testDb = await createTestDb();
    const { sessionId } = await seedSession(testDb.db);
    const now = new Date("2026-07-29T12:00:00.000Z");
    await claimTurn(testDb.db, { sessionId, clientMessageId: "cm-rel", now });
    await releaseTurnClaim(testDb.db, { sessionId, clientMessageId: "cm-rel" });
    const again = await claimTurn(testDb.db, { sessionId, clientMessageId: "cm-rel", now });
    expect(again.kind).toBe("acquired");
  });

  it("distinct clientMessageIds are independent claims", async () => {
    testDb = await createTestDb();
    const { sessionId } = await seedSession(testDb.db);
    const now = new Date("2026-07-29T12:00:00.000Z");
    const a = await claimTurn(testDb.db, { sessionId, clientMessageId: "cm-a", now });
    const b = await claimTurn(testDb.db, { sessionId, clientMessageId: "cm-b", now });
    expect(a.kind).toBe("acquired");
    expect(b.kind).toBe("acquired");
    const rows = await testDb.db.select().from(turnClaims).where(eq(turnClaims.sessionId, sessionId));
    expect(rows).toHaveLength(2);
  });
});
