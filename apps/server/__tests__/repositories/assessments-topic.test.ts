/**
 * Repository tests for `recordTopicAssessment` — Fase P1 topic-scoped mastery write.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import { createStudySession } from "../../src/repositories/study-sessions";
import { createExchange } from "../../src/repositories/exchanges";
import { recordTopicAssessment } from "../../src/repositories/assessments";
import { findMasteryState } from "../../src/repositories/mastery";
import type { AssessorVerdict } from "@buxo/core/assess";

describe("repositories/assessments.ts recordTopicAssessment — P1", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  async function fixture() {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, { email: "topic-assessment@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
    const course = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    const subject = await createSubject(testDb.db, { userId: user.id, courseId: course.id, name: "Física" });
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

  it("records an Assessment and a topic-scoped MasteryState+XP event atomically", async () => {
    const { user, subject, session } = await fixture();
    const exchange = await createExchange(testDb.db, {
      sessionId: session.id,
      index: 0,
      studentMessage: "m",
      tutorReply: "r",
      band: "guiding",
      tutorPromptVersion: "v3",
      tutorModelId: "sonnet-5",
      tutorProviderId: "anthropic",
    });

    const verdict: AssessorVerdict = {
      demonstratedUnderstanding: "solid",
      explainedInOwnWords: true,
      guessedOrPatternMatched: false,
      recommendedBand: "minimal",
      rationale: "Bien.",
    };

    const result = await recordTopicAssessment(testDb.db, {
      userId: user.id,
      sessionId: session.id,
      exchangeId: exchange.id,
      subjectId: subject.id,
      verdict,
      topicId: "topic-123",
      allowedTopicIds: new Set(["topic-123"]),
      visibility: "shadow",
      assessorPromptVersion: "v2",
      assessorModelId: "sonnet-5",
      assessorProviderId: "anthropic",
    });

    expect(result.assessment.subjectId).toBe(subject.id);
    expect(result.state.state.topicId).toBe("topic-123");
    expect(result.xpEvent.delta).toBeGreaterThan(0);

    const state = await findMasteryState(testDb.db, user.id, subject.id, "topic-123");
    expect(state).not.toBeNull();
    expect(state!.topicId).toBe("topic-123");
  });
});
