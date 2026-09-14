import { describe, expect, it, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { fuenteChunks } from "../../src/db/schema";
import {
  countFuenteChunksForSubject,
  replaceFuenteChunksForFuentes,
} from "../../src/repositories/fuente-chunks";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import { createFuente } from "../../src/repositories/fuentes";
import { newId } from "../../src/repositories/ids";

const DIMS = 384;
const ones = () => Array.from({ length: DIMS }, () => 0.01);

async function seed(db: TestDb["db"]) {
  const user = await createUser(db, {
    email: `f2-chunks-${newId()}@example.com`,
    displayName: "F2",
    ageConfirmedAt: new Date().toISOString(),
  });
  const course = await createCourse(db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
  const subject = await createSubject(db, {
    userId: user.id,
    courseId: course.id,
    name: "Química F2",
  });
  const fuente = await createFuente(db, {
    subjectId: subject.id,
    userId: user.id,
    name: "Guía Docente.pdf",
    kind: "pdf",
    text: "La estequiometría.",
  });
  return { subjectId: subject.id, fuenteId: fuente.id };
}

describe("fuente-chunks repo (plan-modal-rag F2)", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  it("replace is idempotent — second run does not duplicate", async () => {
    testDb = await createTestDb();
    const { subjectId, fuenteId } = await seed(testDb.db);

    const draft = {
      subjectId,
      fuenteId,
      fuenteName: "Guía Docente.pdf",
      chunkIndex: 0,
      text: "### Guía Docente.pdf\n\nLa estequiometría.",
      tokenEstimate: 10,
      embedding: ones(),
    };

    const first = await replaceFuenteChunksForFuentes(testDb.db, {
      subjectId,
      modelId: "test-model",
      chunks: [draft],
    });
    expect(first.written).toBe(1);

    const second = await replaceFuenteChunksForFuentes(testDb.db, {
      subjectId,
      modelId: "test-model",
      chunks: [
        draft,
        { ...draft, chunkIndex: 1, text: "### Guía Docente.pdf\n\nOtro." },
      ],
    });
    expect(second.deleted).toBe(1);
    expect(second.written).toBe(2);
    expect(await countFuenteChunksForSubject(testDb.db, subjectId)).toBe(2);

    const rows = await testDb.db
      .select()
      .from(fuenteChunks)
      .where(eq(fuenteChunks.fuenteId, fuenteId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.modelId === "test-model")).toBe(true);
    expect(rows[0]!.embedding).toHaveLength(DIMS);
  });

  it("rejects wrong embedding dimensionality", async () => {
    testDb = await createTestDb();
    const { subjectId, fuenteId } = await seed(testDb.db);

    await expect(
      replaceFuenteChunksForFuentes(testDb.db, {
        subjectId,
        modelId: "m",
        chunks: [
          {
            subjectId,
            fuenteId,
            fuenteName: "G",
            chunkIndex: 0,
            text: "x",
            tokenEstimate: 1,
            embedding: ones().slice(0, 10),
          },
        ],
      }),
    ).rejects.toThrow(/embedding dim/);
  });
});
