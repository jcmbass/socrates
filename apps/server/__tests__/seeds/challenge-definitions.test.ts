/**
 * Tests para la idempotencia de seedChallengeDefinitions.
 *
 * Hallazgo de la auditoría de beta real (docs/plan-beta-real/01-auditoria-registro.md §6):
 * la función se declaraba idempotente pero generaba un `newId()` fresco en cada
 * llamada, por lo que `onConflictDoNothing({ target: [id] })` nunca chocaba y
 * re-semebrar creaba duplicados silenciosos.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { seedChallengeDefinitions } from "../../src/seeds/challenge-definitions";
import { challengeDefinitions } from "../../src/db/schema";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";

describe("seedChallengeDefinitions — idempotencia", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  it("dos llamadas con el mismo subjectId no duplican filas", async () => {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, {
      email: "seed-idempotent@example.com",
      displayName: "Seed Idempotent",
      ageConfirmedAt: new Date().toISOString(),
    });
    const course = await createCourse(testDb.db, {
      userId: user.id,
      gradeLevelId: "sv-bachillerato-1",
    });
    const subject = await createSubject(testDb.db, {
      userId: user.id,
      courseId: course.id,
      name: "Cálculo",
    });

    await seedChallengeDefinitions(testDb.db, subject.id);
    const afterFirst = await testDb.db.select().from(challengeDefinitions);
    expect(afterFirst).toHaveLength(2);

    await seedChallengeDefinitions(testDb.db, subject.id);
    const afterSecond = await testDb.db.select().from(challengeDefinitions);
    expect(afterSecond).toHaveLength(2);

    // Re-seeding a different subject creates a new pair of rows.
    const otherSubject = await createSubject(testDb.db, {
      userId: user.id,
      courseId: course.id,
      name: "Física",
    });
    await seedChallengeDefinitions(testDb.db, otherSubject.id);
    const afterOther = await testDb.db.select().from(challengeDefinitions);
    expect(afterOther).toHaveLength(4);
  });
});
