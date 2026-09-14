import { describe, expect, it } from "vitest";
import { AssessmentSchema, DEMONSTRATED_UNDERSTANDING_LEVELS, type Assessment } from "../assessment";
import { SUBJECT_ROLLUP_TOPIC_KEY } from "../sentinels";

function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: "assessment-1",
    sessionId: "session-1",
    exchangeId: "session-1:0",
    subjectId: "subject-1",
    timestamp: "2026-07-10T10:00:00.000Z",
    demonstratedUnderstanding: "developing",
    explainedInOwnWords: true,
    guessedOrPatternMatched: false,
    recommendedBand: "probing",
    rationale: "El estudiante explicó el paso con sus propias palabras.",
    topicKey: "regla-de-la-cadena",
    assessorPromptVersion: "assessor-v1",
    assessorModelId: "claude-sonnet-5",
    assessorProviderId: "anthropic-direct",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("AssessmentSchema", () => {
  it("accepts a well-formed Assessment with a topicKey", () => {
    expect(AssessmentSchema.safeParse(makeAssessment()).success).toBe(true);
  });

  it("accepts a null topicKey (assessor call ran without topic labeling — B3 §2.9)", () => {
    expect(AssessmentSchema.safeParse(makeAssessment({ topicKey: null })).success).toBe(true);
  });

  it("rejects the '' rollup sentinel as a topicKey (that sentinel is reserved for MasteryState, not Assessment)", () => {
    expect(AssessmentSchema.safeParse(makeAssessment({ topicKey: SUBJECT_ROLLUP_TOPIC_KEY })).success).toBe(false);
  });

  it("rejects an invalid demonstratedUnderstanding", () => {
    expect(AssessmentSchema.safeParse(makeAssessment({ demonstratedUnderstanding: "excellent" as never })).success).toBe(
      false,
    );
  });

  it("every DEMONSTRATED_UNDERSTANDING_LEVELS value round-trips", () => {
    for (const level of DEMONSTRATED_UNDERSTANDING_LEVELS) {
      const result = AssessmentSchema.safeParse(makeAssessment({ demonstratedUnderstanding: level }));
      expect(result.success).toBe(true);
    }
  });

  it("rejects an empty assessorModelId", () => {
    expect(AssessmentSchema.safeParse(makeAssessment({ assessorModelId: "" })).success).toBe(false);
  });
});
