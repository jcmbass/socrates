/**
 * Repository-level tests for `repositories/fuentes.ts` — Fase P1.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import { createFuente, listFuentesBySubject, updateFuente, deleteFuente, findFuenteById } from "../../src/repositories/fuentes";

describe("repositories/fuentes.ts — P1", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  async function fixture() {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, { email: "fuentes-repo@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
    const course = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    const subject = await createSubject(testDb.db, { userId: user.id, courseId: course.id, name: "Física" });
    return { user, subject };
  }

  it("creates and lists text-only fuentes scoped to (user, subject)", async () => {
    const { user, subject } = await fixture();
    const fuente = await createFuente(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      name: "Guía.pdf",
      kind: "pdf",
      text: "La segunda ley de Newton.",
      tokens: 10,
    });
    expect(fuente.text).toBe("La segunda ley de Newton.");

    const listed = await listFuentesBySubject(testDb.db, user.id, subject.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.text).toBe(fuente.text);
  });

  it("updates and deletes a fuente", async () => {
    const { user, subject } = await fixture();
    const fuente = await createFuente(testDb.db, { userId: user.id, subjectId: subject.id, name: "x", kind: "pdf", text: "old" });
    const updated = await updateFuente(testDb.db, fuente.id, { text: "new" });
    expect(updated!.text).toBe("new");

    await deleteFuente(testDb.db, fuente.id);
    expect(await findFuenteById(testDb.db, fuente.id)).toBeNull();
  });
});
