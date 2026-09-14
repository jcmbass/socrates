/**
 * Repository-level tests for `repositories/assessments.ts`'s B1/B2
 * additions (F2 WQ3): `listAssessmentsBySubject`,
 * `countAssessmentsGroupedByTopicKey`, and `recordAssessment`'s
 * topicKey-normalization-on-write.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import { createStudySession } from "../../src/repositories/study-sessions";
import { createExchange } from "../../src/repositories/exchanges";
import { countAssessmentsGroupedByTopicKey, listAssessmentsBySubject, recordAssessment } from "../../src/repositories/assessments";
import type { AssessorVerdict } from "@buxo/core/assess";

const BASE_VERDICT: AssessorVerdict = {
  demonstratedUnderstanding: "solid",
  explainedInOwnWords: true,
  guessedOrPatternMatched: false,
  recommendedBand: "minimal",
  rationale: "Explicó con solidez.",
};

describe("repositories/assessments.ts — B1/B2 additions", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  async function fixture() {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, { email: "assess-repo@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
    const course = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    const subject = await createSubject(testDb.db, { userId: user.id, courseId: course.id, name: "Cálculo" });
    const session = await createStudySession(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      subjectNameSnapshot: subject.name,
      initialBand: "guiding",
      materialAssetIds: [],
      materialSnapshotTextRef: null,
      materialSnapshotInfo: null,
    });
    return { user, subject, session };
  }

  async function makeExchange(sessionId: string, index: number) {
    return createExchange(testDb.db, {
      sessionId,
      index,
      studentMessage: `mensaje ${index}`,
      tutorReply: `respuesta ${index}`,
      band: "guiding",
      tutorPromptVersion: "buxo-socratic-v3",
      tutorModelId: "claude-sonnet-5",
      tutorProviderId: "anthropic",
    });
  }

  it("recordAssessment normalizes topicKeyRaw before storing (B2 §3.2)", async () => {
    const { subject, session } = await fixture();
    const exchange = await makeExchange(session.id, 0);

    const assessment = await recordAssessment(testDb.db, {
      sessionId: session.id,
      exchangeId: exchange.id,
      subjectId: subject.id,
      verdict: BASE_VERDICT,
      topicKeyRaw: "  Derivación de Compuestas  ",
      assessorPromptVersion: "buxo-assessor-v2",
      assessorModelId: "claude-sonnet-5",
      assessorProviderId: "anthropic",
    });

    expect(assessment.topicKey).toBe("derivacion-de-compuestas");
  });

  it("recordAssessment without topicKeyRaw stores null (backward-compatible default)", async () => {
    const { subject, session } = await fixture();
    const exchange = await makeExchange(session.id, 0);

    const assessment = await recordAssessment(testDb.db, {
      sessionId: session.id,
      exchangeId: exchange.id,
      subjectId: subject.id,
      verdict: BASE_VERDICT,
      assessorPromptVersion: "buxo-assessor-v1",
      assessorModelId: "claude-sonnet-5",
      assessorProviderId: "anthropic",
    });

    expect(assessment.topicKey).toBeNull();
  });

  it("listAssessmentsBySubject returns every Assessment ordered by timestamp ascending", async () => {
    const { subject, session } = await fixture();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const exchange = await makeExchange(session.id, i);
      const a = await recordAssessment(testDb.db, {
        sessionId: session.id,
        exchangeId: exchange.id,
        subjectId: subject.id,
        verdict: BASE_VERDICT,
        assessorPromptVersion: "buxo-assessor-v2",
        assessorModelId: "claude-sonnet-5",
        assessorProviderId: "anthropic",
      });
      ids.push(a.id);
    }

    const listed = await listAssessmentsBySubject(testDb.db, subject.id);
    expect(listed.map((a) => a.id)).toEqual(ids);
  });

  it("listAssessmentsBySubject filters by topicKey when given", async () => {
    const { subject, session } = await fixture();
    const exchangeA = await makeExchange(session.id, 0);
    const exchangeB = await makeExchange(session.id, 1);

    await recordAssessment(testDb.db, {
      sessionId: session.id,
      exchangeId: exchangeA.id,
      subjectId: subject.id,
      verdict: BASE_VERDICT,
      topicKeyRaw: "Fracciones equivalentes",
      assessorPromptVersion: "buxo-assessor-v2",
      assessorModelId: "claude-sonnet-5",
      assessorProviderId: "anthropic",
    });
    await recordAssessment(testDb.db, {
      sessionId: session.id,
      exchangeId: exchangeB.id,
      subjectId: subject.id,
      verdict: BASE_VERDICT,
      topicKeyRaw: "Derivadas",
      assessorPromptVersion: "buxo-assessor-v2",
      assessorModelId: "claude-sonnet-5",
      assessorProviderId: "anthropic",
    });

    const onlyFractions = await listAssessmentsBySubject(testDb.db, subject.id, { topicKey: "fracciones-equivalentes" });
    expect(onlyFractions).toHaveLength(1);
    expect(onlyFractions[0].topicKey).toBe("fracciones-equivalentes");
  });

  it("countAssessmentsGroupedByTopicKey groups correctly and excludes null topicKey", async () => {
    const { subject, session } = await fixture();
    const labels = ["Fracciones", "Fracciones", "Fracciones", "Derivadas", null];
    for (let i = 0; i < labels.length; i++) {
      const exchange = await makeExchange(session.id, i);
      await recordAssessment(testDb.db, {
        sessionId: session.id,
        exchangeId: exchange.id,
        subjectId: subject.id,
        verdict: BASE_VERDICT,
        topicKeyRaw: labels[i],
        assessorPromptVersion: "buxo-assessor-v2",
        assessorModelId: "claude-sonnet-5",
        assessorProviderId: "anthropic",
      });
    }

    const grouped = await countAssessmentsGroupedByTopicKey(testDb.db, subject.id);
    const byKey = Object.fromEntries(grouped.map((g) => [g.topicKey, g.count]));
    expect(byKey["fracciones"]).toBe(3);
    expect(byKey["derivadas"]).toBe(1);
    expect(Object.keys(byKey)).toHaveLength(2); // null excluded
  });
});
