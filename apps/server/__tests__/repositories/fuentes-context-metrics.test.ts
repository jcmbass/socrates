/**
 * plan-modal-rag F0.1 — fuentes_context_metrics repository.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CHARS_PER_TOKEN, MAX_TOKENS } from "@buxo/core/truncate";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { fuentesContextMetrics } from "../../src/db/schema";
import { recordFuentesContextMetrics } from "../../src/repositories/fuentes-context-metrics";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import { createStudySession } from "../../src/repositories/study-sessions";
import { newId } from "../../src/repositories/ids";

async function seed(db: TestDb["db"]) {
  const user = await createUser(db, {
    email: `fcm-${newId()}@example.com`,
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
  return { subjectId: subject.id, sessionId: session.id };
}

describe("recordFuentesContextMetrics (plan-modal-rag F0.1)", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  it("inserts one row with identifiers + numbers only (no material text columns)", async () => {
    testDb = await createTestDb();
    const { subjectId, sessionId } = await seed(testDb.db);

    const row = await recordFuentesContextMetrics(testDb.db, {
      builder: "topic",
      subjectId,
      sessionId,
      kind: "topic",
      fuenteCount: 2,
      corpusTokens: 1200,
      truncated: false,
      droppedTokens: 0,
    });

    expect(row.subjectId).toBe(subjectId);
    expect(row.sessionId).toBe(sessionId);
    expect(row.builder).toBe("topic");
    expect(row.truncated).toBe(false);
    expect(row.droppedTokens).toBe(0);

    const cols = Object.keys(fuentesContextMetrics).filter((k) => !k.startsWith("_") && k !== "enableRLS");
    // Defensive: schema must not grow a text blob column for material.
    expect(cols).not.toContain("text");
    expect(cols).not.toContain("material");
    expect(cols).not.toContain("corpusText");

    const [stored] = await testDb.db
      .select()
      .from(fuentesContextMetrics)
      .where(eq(fuentesContextMetrics.id, row.id));
    expect(JSON.stringify(stored)).not.toMatch(/ángulos|triángulo|guía/i);
  });

  it("records truncated=true with dropped_tokens when corpus is oversized", async () => {
    testDb = await createTestDb();
    const { subjectId, sessionId } = await seed(testDb.db);
    const dropped = Math.ceil((4_000 * CHARS_PER_TOKEN) / CHARS_PER_TOKEN);

    const row = await recordFuentesContextMetrics(testDb.db, {
      builder: "fuentes",
      subjectId,
      sessionId,
      kind: "milestone",
      fuenteCount: 1,
      corpusTokens: MAX_TOKENS + 4_000,
      truncated: true,
      droppedTokens: dropped,
    });

    expect(row.builder).toBe("fuentes");
    expect(row.kind).toBe("milestone");
    expect(row.truncated).toBe(true);
    expect(row.droppedTokens).toBe(dropped);
    expect(row.corpusTokens).toBeGreaterThan(MAX_TOKENS);
  });
});
