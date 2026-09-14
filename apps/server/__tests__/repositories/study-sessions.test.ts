/**
 * Repository-level tests for `repositories/study-sessions.ts`'s F2 WQ3
 * parte C1 addition: `materialEvents`. Route-level coverage (creation +
 * mid-session attach + GET payload) lives in
 * `../routes/sessions-materials.test.ts` — this file covers what only a
 * direct DB/repo test can: a row written before this column existed
 * (simulated here as an insert that omits it) reads back with the
 * NOT NULL DEFAULT '[]'::jsonb the migration adds, never null/undefined.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { studySessions } from "../../src/db/schema";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import { findStudySessionById } from "../../src/repositories/study-sessions";
import { newId, nowIso } from "../../src/repositories/ids";

describe("repositories/study-sessions.ts — materialEvents (F2 WQ3 parte C1)", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  it("a row inserted WITHOUT material_events (pre-migration shape) reads back as [] — the migration never breaks old rows", async () => {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, { email: "premigration@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
    const course = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    const subject = await createSubject(testDb.db, { userId: user.id, courseId: course.id, name: "Química" });

    const now = nowIso();
    const id = newId();
    // Raw insert that mirrors what a row created BEFORE this migration would
    // have had — material_events, the column this migration added, is
    // explicitly OMITTED here, so only the column's SQL DEFAULT can fill it
    // in (the drizzle insert type marks it optional precisely because the
    // schema declares `.default([])` — see db/schema.ts).
    await testDb.db.insert(studySessions).values({
      id,
      userId: user.id,
      subjectId: subject.id,
      subjectNameSnapshot: subject.name,
      createdAt: now,
      updatedAt: now,
      status: "active",
      initialBand: "guiding",
      materialAssetIds: [],
      materialSnapshotTextRef: null,
      materialSnapshotInfo: null,
      bandChanges: [],
      schemaVersion: 1,
    });

    const found = await findStudySessionById(testDb.db, user.id, id);
    expect(found?.materialEvents).toEqual([]);
  });
});
