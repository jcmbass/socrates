import { describe, expect, it } from "vitest";
import {
  AchievementSchema,
  ChallengeDefinitionSchema,
  ChallengeScopeSchema,
  StreakSchema,
  type Achievement,
  type ChallengeDefinition,
  type Streak,
} from "../gamification";

function makeChallengeDefinition(overrides: Partial<ChallengeDefinition> = {}): ChallengeDefinition {
  return {
    id: "challenge-1",
    scope: { kind: "subject", subjectId: "subject-1" },
    titleKey: "challenge.consolidacion.title",
    descriptionKey: "challenge.consolidacion.description",
    version: "1",
    criteria: { requiredTier: "consolidated" },
    active: true,
    createdAt: "2026-07-10T10:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

function makeAchievement(overrides: Partial<Achievement> = {}): Achievement {
  return {
    id: "achievement-1",
    userId: "user-1",
    challengeDefinitionId: "challenge-1",
    challengeDefinitionVersion: "1",
    subjectId: "subject-1",
    topicKey: "regla-de-la-cadena",
    earnedAt: "2026-07-10T10:00:00.000Z",
    status: "earned",
    revokedAt: null,
    revokedReason: null,
    evidenceAssessmentIds: ["assessment-1", "assessment-2"],
    retryOf: null,
    schemaVersion: 1,
    ...overrides,
  };
}

function makeStreak(overrides: Partial<Streak> = {}): Streak {
  return {
    id: "streak-1",
    userId: "user-1",
    kind: "assessment_approved",
    current: 3,
    longest: 5,
    lastQualifyingAssessmentId: "assessment-2",
    lastQualifyingAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("ChallengeScopeSchema", () => {
  it("accepts all three scope kinds", () => {
    expect(ChallengeScopeSchema.safeParse({ kind: "generic" }).success).toBe(true);
    expect(ChallengeScopeSchema.safeParse({ kind: "subject", subjectId: "subject-1" }).success).toBe(true);
    expect(
      ChallengeScopeSchema.safeParse({ kind: "topic", subjectId: "subject-1", topicKey: "x" }).success,
    ).toBe(true);
  });

  it("rejects a topic scope missing subjectId", () => {
    const result = ChallengeScopeSchema.safeParse({ kind: "topic", topicKey: "x" });
    expect(result.success).toBe(false);
  });
});

describe("ChallengeDefinitionSchema", () => {
  it("accepts a well-formed definition with opaque criteria", () => {
    expect(ChallengeDefinitionSchema.safeParse(makeChallengeDefinition()).success).toBe(true);
  });

  it("accepts any criteria shape (B2-opaque field)", () => {
    expect(ChallengeDefinitionSchema.safeParse(makeChallengeDefinition({ criteria: 42 })).success).toBe(true);
    expect(ChallengeDefinitionSchema.safeParse(makeChallengeDefinition({ criteria: null })).success).toBe(true);
  });
});

describe("AchievementSchema", () => {
  it("accepts a well-formed earned Achievement", () => {
    expect(AchievementSchema.safeParse(makeAchievement()).success).toBe(true);
  });

  it("accepts a revoked Achievement with a reason", () => {
    const result = AchievementSchema.safeParse(
      makeAchievement({ status: "revoked", revokedAt: "2026-07-11T10:00:00.000Z", revokedReason: "sospecha de farmeo" }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a retry pointing at a prior Achievement", () => {
    expect(AchievementSchema.safeParse(makeAchievement({ retryOf: "achievement-0" })).success).toBe(true);
  });

  it("rejects an invalid status", () => {
    expect(AchievementSchema.safeParse(makeAchievement({ status: "pending" as never })).success).toBe(false);
  });
});

describe("StreakSchema", () => {
  it("accepts a well-formed Streak", () => {
    expect(StreakSchema.safeParse(makeStreak()).success).toBe(true);
  });

  it("rejects a negative current count", () => {
    expect(StreakSchema.safeParse(makeStreak({ current: -1 })).success).toBe(false);
  });
});
