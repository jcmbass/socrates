import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { sessionOpenings } from "../../src/db/schema";
import {
  claimSessionOpeningGeneration,
  createSessionOpening,
  findReadySessionOpeningBySessionId,
  OPENING_CLAIM_ORPHAN_MS,
} from "../../src/repositories/session-openings";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import { createStudySession } from "../../src/repositories/study-sessions";
import { newId } from "../../src/repositories/ids";

async function seedSession(db: TestDb["db"]) {
  const user = await createUser(db, {
    email: `opening-${newId()}@example.com`,
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
    kind: "topic",
    topicId: "topic-1",
  });
  return { sessionId: session.id, userId: user.id };
}

const readyInput = (sessionId: string, userId: string) => ({
  sessionId,
  userId,
  text: "Una idea breve. ¿Qué pasa si duplicás x?",
  tutorPromptVersion: "buxo-socratic-v3",
  tutorModelId: "fake-model",
  tutorProviderId: "fake",
  grounding: "general" as const,
});

describe("session_openings repository", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  it("createSessionOpening race: one insert wins, loser re-reads and does not insert a second row", async () => {
    testDb = await createTestDb();
    const { sessionId, userId } = await seedSession(testDb.db);
    const [a, b] = await Promise.all([
      createSessionOpening(testDb.db, readyInput(sessionId, userId)),
      createSessionOpening(testDb.db, readyInput(sessionId, userId)),
    ]);
    expect([a.inserted, b.inserted].sort()).toEqual([false, true]);
    expect(a.opening.id).toBe(b.opening.id);
    const rows = await testDb.db.select().from(sessionOpenings).where(eq(sessionOpenings.sessionId, sessionId));
    expect(rows).toHaveLength(1);
  });

  it("claimSessionOpeningGeneration: concurrent first claims are acquired vs in_flight", async () => {
    testDb = await createTestDb();
    const { sessionId, userId } = await seedSession(testDb.db);
    const now = new Date("2026-09-07T12:00:00.000Z");
    const [a, b] = await Promise.all([
      claimSessionOpeningGeneration(testDb.db, { sessionId, userId, now }),
      claimSessionOpeningGeneration(testDb.db, { sessionId, userId, now }),
    ]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["acquired", "in_flight"]);
  });

  it("reclaims a stale generating row after the orphan window", async () => {
    testDb = await createTestDb();
    const { sessionId, userId } = await seedSession(testDb.db);
    const staleAt = new Date("2026-09-07T12:00:00.000Z");
    await testDb.db.insert(sessionOpenings).values({
      id: newId(),
      sessionId,
      userId,
      text: null,
      tutorModelId: null,
      tutorProviderId: null,
      tutorPromptVersion: null,
      grounding: null,
      status: "generating",
      claimedAt: staleAt.toISOString(),
      createdAt: staleAt.toISOString(),
      schemaVersion: 1,
    });

    const now = new Date(staleAt.getTime() + OPENING_CLAIM_ORPHAN_MS + 1000);
    const result = await claimSessionOpeningGeneration(testDb.db, { sessionId, userId, now });
    expect(result.kind).toBe("acquired");
    expect(await findReadySessionOpeningBySessionId(testDb.db, sessionId)).toBeNull();
  });
});
