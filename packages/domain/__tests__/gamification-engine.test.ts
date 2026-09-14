import { describe, expect, it } from "vitest";
import type { Assessment } from "../assessment";
import type { ChallengeCriteria, ChallengeDefinition, Streak } from "../gamification";
import type { MasteryLevel } from "../mastery";
import {
  B2_GAMIFICATION_VERSION,
  DEFAULT_GAMIFICATION_CONFIG,
  updateStreak,
  maybeAwardAchievements,
  explainMovement,
  explainChallengeGap,
  USER_FACING_REASON_KEYS,
} from "../gamification-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: "assessment-1",
    sessionId: "session-1",
    exchangeId: "session-1:0",
    subjectId: "subject-1",
    timestamp: "2026-01-01T10:00:00.000Z",
    demonstratedUnderstanding: "developing",
    explainedInOwnWords: true,
    guessedOrPatternMatched: false,
    recommendedBand: "probing",
    rationale: "rationale",
    topicKey: null,
    assessorPromptVersion: "assessor-v1",
    assessorModelId: "claude-sonnet-5",
    assessorProviderId: "anthropic-direct",
    schemaVersion: 1,
    ...overrides,
  };
}

/** An assessment that qualifies for streak (explained + not guessed + not "none"). */
function qualifyingAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return makeAssessment({
    demonstratedUnderstanding: "weak",
    explainedInOwnWords: true,
    guessedOrPatternMatched: false,
    ...overrides,
  });
}

/** An assessment that does NOT qualify (guessed). */
function nonQualifyingAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return makeAssessment({
    demonstratedUnderstanding: "solid",
    explainedInOwnWords: true,
    guessedOrPatternMatched: true,
    ...overrides,
  });
}

function makeStreak(overrides: Partial<Streak> = {}): Streak {
  return {
    id: "streak-1",
    userId: "user-1",
    kind: "assessment_approved",
    current: 0,
    longest: 0,
    lastQualifyingAssessmentId: null,
    lastQualifyingAt: null,
    updatedAt: "2026-01-01T10:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

function makeLevel(overrides: Partial<MasteryLevel> = {}): MasteryLevel {
  return {
    tier: "emerging",
    positiveStreak: 0,
    negativeStreak: 0,
    strongCount: 0,
    recentStrongEvidence: [],
    lastPositiveAt: null,
    lastPromotionAt: null,
    ...overrides,
  };
}

function makeChallengeDefinition(overrides: Partial<ChallengeDefinition> = {}): ChallengeDefinition {
  return {
    id: "challenge-1",
    scope: { kind: "subject", subjectId: "subject-1" },
    titleKey: "challenge.consolidacion.title",
    descriptionKey: "challenge.consolidacion.description",
    version: "1",
    criteria: { requiredTier: "consolidated", minDistinctSessions: 2, minDistinctCalendarDays: 2 } satisfies ChallengeCriteria,
    active: true,
    createdAt: "2026-07-10T10:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// B2_GAMIFICATION_VERSION / DEFAULT_GAMIFICATION_CONFIG
// ---------------------------------------------------------------------------

describe("B2_GAMIFICATION_VERSION / DEFAULT_GAMIFICATION_CONFIG", () => {
  it("is versioned as b2-gam-1", () => {
    expect(B2_GAMIFICATION_VERSION).toBe("b2-gam-1");
    expect(DEFAULT_GAMIFICATION_CONFIG.version).toBe("b2-gam-1");
  });

  it("carries presets for all three non-emerging tiers", () => {
    expect(DEFAULT_GAMIFICATION_CONFIG.challengePresets.developing.requiredTier).toBe("developing");
    expect(DEFAULT_GAMIFICATION_CONFIG.challengePresets.consolidated.requiredTier).toBe("consolidated");
    expect(DEFAULT_GAMIFICATION_CONFIG.challengePresets.mastered.requiredTier).toBe("mastered");
  });
});

// ---------------------------------------------------------------------------
// USER_FACING_REASON_KEYS
// ---------------------------------------------------------------------------

describe("USER_FACING_REASON_KEYS", () => {
  it("contains all expected keys", () => {
    expect(USER_FACING_REASON_KEYS).toContain("EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS");
    expect(USER_FACING_REASON_KEYS).toContain("SUSTAINED_OVER_TIME");
    expect(USER_FACING_REASON_KEYS).toContain("NEEDS_MORE_PRACTICE");
    expect(USER_FACING_REASON_KEYS).toContain("PAUSE_TOO_LONG");
    expect(USER_FACING_REASON_KEYS).toContain("NEEDS_MORE_SESSIONS");
    expect(USER_FACING_REASON_KEYS).toContain("NEEDS_MORE_DAYS");
    expect(USER_FACING_REASON_KEYS).toContain("NEEDS_HIGHER_TIER");
  });
});

// ---------------------------------------------------------------------------
// updateStreak — B2 §1.7
// ---------------------------------------------------------------------------

describe("updateStreak (B2 §1.7)", () => {
  it("increments current and updates longest when the assessment qualifies", () => {
    const prev = makeStreak({ current: 2, longest: 5 });
    const next = updateStreak(prev, qualifyingAssessment({ id: "a1", timestamp: "2026-01-02T10:00:00.000Z" }));

    expect(next.current).toBe(3);
    expect(next.longest).toBe(5); // longest unchanged (5 > 3)
    expect(next.lastQualifyingAssessmentId).toBe("a1");
    expect(next.lastQualifyingAt).toBe("2026-01-02T10:00:00.000Z");
  });

  it("updates longest when current exceeds previous longest", () => {
    const prev = makeStreak({ current: 5, longest: 5 });
    const next = updateStreak(prev, qualifyingAssessment({ id: "a1" }));

    expect(next.current).toBe(6);
    expect(next.longest).toBe(6);
  });

  it("resets current to 0 when the assessment does NOT qualify", () => {
    const prev = makeStreak({ current: 3, longest: 5 });
    const next = updateStreak(prev, nonQualifyingAssessment({ id: "a1" }));

    expect(next.current).toBe(0);
    expect(next.longest).toBe(5); // longest never decreases
  });

  it("longest never decreases even after a long streak is broken", () => {
    const prev = makeStreak({ current: 10, longest: 10 });
    const next = updateStreak(prev, nonQualifyingAssessment({ id: "a1" }));

    expect(next.current).toBe(0);
    expect(next.longest).toBe(10);
  });

  it("weak honest understanding DOES qualify (B2 §1.7 note)", () => {
    const prev = makeStreak({ current: 0, longest: 0 });
    const next = updateStreak(
      prev,
      makeAssessment({
        demonstratedUnderstanding: "weak",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
        id: "a1",
      }),
    );

    expect(next.current).toBe(1);
  });

  it("guessedOrPatternMatched=true NEVER qualifies, regardless of understanding level", () => {
    const prev = makeStreak({ current: 5, longest: 5 });
    const next = updateStreak(
      prev,
      makeAssessment({
        demonstratedUnderstanding: "solid",
        explainedInOwnWords: true,
        guessedOrPatternMatched: true,
        id: "a1",
      }),
    );

    expect(next.current).toBe(0);
  });

  it("demonstratedUnderstanding='none' does NOT qualify even if explained and not guessed", () => {
    const prev = makeStreak({ current: 3, longest: 3 });
    const next = updateStreak(
      prev,
      makeAssessment({
        demonstratedUnderstanding: "none",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
        id: "a1",
      }),
    );

    expect(next.current).toBe(0);
  });

  it("explainedInOwnWords=false does NOT qualify even if understanding is solid", () => {
    const prev = makeStreak({ current: 3, longest: 3 });
    const next = updateStreak(
      prev,
      makeAssessment({
        demonstratedUnderstanding: "solid",
        explainedInOwnWords: false,
        guessedOrPatternMatched: false,
        id: "a1",
      }),
    );

    expect(next.current).toBe(0);
  });

  it("does not mutate the previous Streak object", () => {
    const prev = makeStreak({ current: 2, longest: 5 });
    const prevCurrent = prev.current;
    const prevLongest = prev.longest;

    updateStreak(prev, qualifyingAssessment({ id: "a1" }));

    expect(prev.current).toBe(prevCurrent);
    expect(prev.longest).toBe(prevLongest);
  });

  it("streak is of approved assessments, NOT of days (B2 §1.7 / O-7)", () => {
    // Two qualifying assessments on the same day both increment the streak.
    const prev = makeStreak({ current: 0, longest: 0 });
    const afterFirst = updateStreak(prev, qualifyingAssessment({ id: "a1", timestamp: "2026-01-01T10:00:00.000Z" }));
    const afterSecond = updateStreak(afterFirst, qualifyingAssessment({ id: "a2", timestamp: "2026-01-01T11:00:00.000Z" }));

    expect(afterSecond.current).toBe(2); // Two assessments, same day — both count
  });
});

// ---------------------------------------------------------------------------
// maybeAwardAchievements — B2 §4.2-§4.3
// ---------------------------------------------------------------------------

describe("maybeAwardAchievements (B2 §4.2-§4.3)", () => {
  const userId = "user-1";
  const subjectId = "subject-1";

  function consolidatedLevelWithEvidence(): MasteryLevel {
    return makeLevel({
      tier: "consolidated",
      recentStrongEvidence: [
        { assessmentId: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" },
        { assessmentId: "a2", sessionId: "s1", timestamp: "2026-01-01T10:05:00.000Z" },
        { assessmentId: "a3", sessionId: "s2", timestamp: "2026-01-02T09:00:00.000Z" },
      ],
    });
  }

  it("awards a challenge when criteria are met", () => {
    const def = makeChallengeDefinition({
      id: "challenge-1",
      criteria: { requiredTier: "consolidated", minDistinctSessions: 2, minDistinctCalendarDays: 2 },
    });
    const level = consolidatedLevelWithEvidence();

    const result = maybeAwardAchievements(userId, subjectId, null, level, [], [def]);

    expect(result).toHaveLength(1);
    expect(result[0].challengeDefinitionId).toBe("challenge-1");
    expect(result[0].evidenceAssessmentIds).toEqual(["a1", "a2", "a3"]);
    expect(result[0].retryOf).toBeNull();
  });

  it("does NOT award when tier is below requiredTier", () => {
    const def = makeChallengeDefinition({
      id: "challenge-1",
      criteria: { requiredTier: "consolidated", minDistinctSessions: 1, minDistinctCalendarDays: 1 },
    });
    const level = makeLevel({ tier: "developing" });

    const result = maybeAwardAchievements(userId, subjectId, null, level, [], [def]);

    expect(result).toHaveLength(0);
  });

  it("does NOT re-award an already earned challenge (idempotent)", () => {
    const def = makeChallengeDefinition({
      id: "challenge-1",
      criteria: { requiredTier: "consolidated", minDistinctSessions: 2, minDistinctCalendarDays: 2 },
    });
    const level = consolidatedLevelWithEvidence();
    const existingEarned = [
      { challengeDefinitionId: "challenge-1", status: "earned" as const },
    ];

    const result = maybeAwardAchievements(userId, subjectId, null, level, existingEarned, [def]);

    expect(result).toHaveLength(0);
  });

  it("does NOT re-award when surpassing the same tier (reaching consolidated twice)", () => {
    const def = makeChallengeDefinition({
      id: "challenge-1",
      criteria: { requiredTier: "consolidated", minDistinctSessions: 2, minDistinctCalendarDays: 2 },
    });
    const level = consolidatedLevelWithEvidence();
    const existingEarned = [
      { challengeDefinitionId: "challenge-1", status: "earned" as const },
    ];

    // Even with more evidence, the same challenge is not re-awarded.
    const result = maybeAwardAchievements(userId, subjectId, null, level, existingEarned, [def]);

    expect(result).toHaveLength(0);
  });

  it("awards a DIFFERENT challenge when reaching a higher tier (distinct ChallengeDefinition)", () => {
    const developingDef = makeChallengeDefinition({
      id: "challenge-dev",
      criteria: { requiredTier: "developing", minDistinctSessions: 1, minDistinctCalendarDays: 1 },
    });
    const consolidatedDef = makeChallengeDefinition({
      id: "challenge-con",
      criteria: { requiredTier: "consolidated", minDistinctSessions: 2, minDistinctCalendarDays: 2 },
    });
    const level = consolidatedLevelWithEvidence();
    const existingEarned = [
      { challengeDefinitionId: "challenge-dev", status: "earned" as const },
    ];

    const result = maybeAwardAchievements(userId, subjectId, null, level, existingEarned, [developingDef, consolidatedDef]);

    // Only the consolidated challenge should be new — developing was already earned.
    expect(result).toHaveLength(1);
    expect(result[0].challengeDefinitionId).toBe("challenge-con");
  });

  it("does NOT award when minDistinctSessions is not met", () => {
    const def = makeChallengeDefinition({
      id: "challenge-1",
      criteria: { requiredTier: "consolidated", minDistinctSessions: 3, minDistinctCalendarDays: 1 },
    });
    const level = consolidatedLevelWithEvidence(); // only 2 distinct sessions

    const result = maybeAwardAchievements(userId, subjectId, null, level, [], [def]);

    expect(result).toHaveLength(0);
  });

  it("does NOT award when minDistinctCalendarDays is not met", () => {
    const def = makeChallengeDefinition({
      id: "challenge-1",
      criteria: { requiredTier: "consolidated", minDistinctSessions: 1, minDistinctCalendarDays: 3 },
    });
    const level = consolidatedLevelWithEvidence(); // only 2 distinct days

    const result = maybeAwardAchievements(userId, subjectId, null, level, [], [def]);

    expect(result).toHaveLength(0);
  });

  it("skips definitions with unparseable criteria (defensive)", () => {
    const def = makeChallengeDefinition({
      id: "challenge-1",
      criteria: "not-a-criteria-object" as never,
    });
    const level = consolidatedLevelWithEvidence();

    const result = maybeAwardAchievements(userId, subjectId, null, level, [], [def]);

    expect(result).toHaveLength(0);
  });

  it("skips definitions with null criteria (defensive)", () => {
    const def = makeChallengeDefinition({
      id: "challenge-1",
      criteria: null as never,
    });
    const level = consolidatedLevelWithEvidence();

    const result = maybeAwardAchievements(userId, subjectId, null, level, [], [def]);

    expect(result).toHaveLength(0);
  });

  it("retryOf is always null — caller-owned (C2/G2 resolves I-11 linkage at persist time)", () => {
    // The engine does NOT set retryOf. Even when a prior revoked Achievement
    // exists, the function returns retryOf: null. The caller (C2/G2) resolves
    // the I-11 retry linkage by looking up the prior revoked Achievement's id
    // for (userId, challengeDefinitionId, scope) at persist time.
    const def = makeChallengeDefinition({
      id: "challenge-1",
      criteria: { requiredTier: "consolidated", minDistinctSessions: 2, minDistinctCalendarDays: 2 },
    });
    const level = consolidatedLevelWithEvidence();
    const existingEarned = [
      { challengeDefinitionId: "challenge-1", status: "revoked" as const },
    ];

    const result = maybeAwardAchievements(userId, subjectId, null, level, existingEarned, [def]);

    expect(result).toHaveLength(1);
    expect(result[0].retryOf).toBeNull();
  });

  it("does not award for generic-scope definitions (outside tier-driven flow)", () => {
    const def = makeChallengeDefinition({
      id: "challenge-generic",
      scope: { kind: "generic" },
      criteria: { requiredTier: "developing", minDistinctSessions: 1, minDistinctCalendarDays: 1 },
    });
    const level = makeLevel({ tier: "developing", recentStrongEvidence: [{ assessmentId: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" }] });

    const result = maybeAwardAchievements(userId, subjectId, null, level, [], [def]);

    expect(result).toHaveLength(0);
  });

  it("does not mutate input arrays", () => {
    const def = makeChallengeDefinition({
      criteria: { requiredTier: "consolidated", minDistinctSessions: 2, minDistinctCalendarDays: 2 },
    });
    const level = consolidatedLevelWithEvidence();
    const defs = [def];
    const defsLength = defs.length;

    maybeAwardAchievements(userId, subjectId, null, level, [], defs);

    expect(defs).toHaveLength(defsLength);
  });
});

// ---------------------------------------------------------------------------
// explainMovement — B2 §9.2
// ---------------------------------------------------------------------------

describe("explainMovement (B2 §9.2)", () => {
  it("returns EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS for any promotion", () => {
    const result = explainMovement("emerging", "developing", []);
    expect(result).toContain("EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS");
  });

  it("adds SUSTAINED_OVER_TIME when promoting to mastered", () => {
    const result = explainMovement("consolidated", "mastered", []);
    expect(result).toContain("EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS");
    expect(result).toContain("SUSTAINED_OVER_TIME");
  });

  it("returns NEEDS_MORE_PRACTICE for demotion (with contributing assessments)", () => {
    const result = explainMovement("developing", "emerging", [
      { sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" },
    ]);
    expect(result).toEqual(["NEEDS_MORE_PRACTICE"]);
  });

  it("returns PAUSE_TOO_LONG for decay (no contributing assessments)", () => {
    const result = explainMovement("developing", "emerging", []);
    expect(result).toEqual(["PAUSE_TOO_LONG"]);
  });

  it("returns empty array when tier is unchanged", () => {
    const result = explainMovement("developing", "developing", []);
    expect(result).toEqual([]);
  });

  it("never exposes exact numbers in reason keys", () => {
    const promotionKeys = explainMovement("emerging", "developing", []);
    const demotionKeys = explainMovement("developing", "emerging", []);

    // All keys must be from the USER_FACING_REASON_KEYS set.
    for (const key of [...promotionKeys, ...demotionKeys]) {
      expect(USER_FACING_REASON_KEYS).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// explainChallengeGap — B2 §4.5
// ---------------------------------------------------------------------------

describe("explainChallengeGap (B2 §4.5)", () => {
  const criteria: ChallengeCriteria = {
    requiredTier: "consolidated",
    minDistinctSessions: 2,
    minDistinctCalendarDays: 2,
  };

  it("returns NEEDS_HIGHER_TIER when tier is below requiredTier", () => {
    const level = makeLevel({ tier: "developing" });
    const result = explainChallengeGap(criteria, level);
    expect(result).toEqual(["NEEDS_HIGHER_TIER"]);
  });

  it("returns NEEDS_HIGHER_TIER for emerging (never a challenge tier)", () => {
    const level = makeLevel({ tier: "emerging" });
    const result = explainChallengeGap(criteria, level);
    expect(result).toEqual(["NEEDS_HIGHER_TIER"]);
  });

  it("returns NEEDS_MORE_SESSIONS when session count is insufficient", () => {
    const level = makeLevel({
      tier: "consolidated",
      recentStrongEvidence: [
        { assessmentId: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" },
        { assessmentId: "a2", sessionId: "s1", timestamp: "2026-01-01T10:05:00.000Z" },
      ],
    });
    const result = explainChallengeGap(criteria, level);
    expect(result).toContain("NEEDS_MORE_SESSIONS");
    expect(result).toContain("NEEDS_MORE_DAYS"); // also only 1 day
  });

  it("returns NEEDS_MORE_DAYS when calendar days are insufficient", () => {
    const level = makeLevel({
      tier: "consolidated",
      recentStrongEvidence: [
        { assessmentId: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" },
        { assessmentId: "a2", sessionId: "s2", timestamp: "2026-01-01T11:00:00.000Z" },
      ],
    });
    const result = explainChallengeGap(criteria, level);
    expect(result).not.toContain("NEEDS_MORE_SESSIONS"); // 2 sessions
    expect(result).toContain("NEEDS_MORE_DAYS"); // only 1 day
  });

  it("returns empty array when all criteria are met", () => {
    const level = makeLevel({
      tier: "consolidated",
      recentStrongEvidence: [
        { assessmentId: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" },
        { assessmentId: "a2", sessionId: "s2", timestamp: "2026-01-02T09:00:00.000Z" },
      ],
    });
    const result = explainChallengeGap(criteria, level);
    expect(result).toEqual([]);
  });

  it("never exposes exact numbers in reason keys", () => {
    const level = makeLevel({ tier: "developing" });
    const result = explainChallengeGap(criteria, level);

    for (const key of result) {
      expect(USER_FACING_REASON_KEYS).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Retry without reduced bar — B2 §6.3
// ---------------------------------------------------------------------------

describe("retry without reduced bar (B2 §6.3)", () => {
  it("maybeAwardAchievements uses the SAME criteria for retry — no discount", () => {
    // The criteria for a retry are exactly the same ChallengeCriteria.
    // This test verifies that the function does not have any special
    // reduced-threshold path for retries.
    const def = makeChallengeDefinition({
      id: "challenge-1",
      criteria: { requiredTier: "consolidated", minDistinctSessions: 2, minDistinctCalendarDays: 2 },
    });
    const level = makeLevel({
      tier: "consolidated",
      recentStrongEvidence: [
        { assessmentId: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" },
        { assessmentId: "a2", sessionId: "s1", timestamp: "2026-01-01T10:05:00.000Z" },
      ],
    });
    // Only 1 distinct session — should NOT award even with a prior revoked achievement.
    const existingEarned = [
      { challengeDefinitionId: "challenge-1", status: "revoked" as const },
    ];

    const result = maybeAwardAchievements("user-1", "subject-1", null, level, existingEarned, [def]);

    expect(result).toHaveLength(0); // Not awarded — same strict criteria apply.
  });

  it("retry succeeds when the SAME criteria are met (no discount needed)", () => {
    const def = makeChallengeDefinition({
      id: "challenge-1",
      criteria: { requiredTier: "consolidated", minDistinctSessions: 2, minDistinctCalendarDays: 2 },
    });
    const level = makeLevel({
      tier: "consolidated",
      recentStrongEvidence: [
        { assessmentId: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" },
        { assessmentId: "a2", sessionId: "s2", timestamp: "2026-01-02T09:00:00.000Z" },
      ],
    });
    const existingEarned = [
      { challengeDefinitionId: "challenge-1", status: "revoked" as const },
    ];

    const result = maybeAwardAchievements("user-1", "subject-1", null, level, existingEarned, [def]);

    expect(result).toHaveLength(1);
    // retryOf is caller-owned — always null from the engine. C2/G2 resolves
    // the I-11 linkage at persist time.
    expect(result[0].retryOf).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Emerging never a challenge — B2 §4.1
// ---------------------------------------------------------------------------

describe("emerging never a challenge (B2 §4.1)", () => {
  it("ChallengeCriteria.requiredTier excludes 'emerging' by type", () => {
    // This is a compile-time check — the type `Exclude<MasteryTier, "emerging">`
    // prevents "emerging" from being assigned. At runtime, we verify the
    // presets don't include it.
    const presets = DEFAULT_GAMIFICATION_CONFIG.challengePresets;
    const tiers = [presets.developing.requiredTier, presets.consolidated.requiredTier, presets.mastered.requiredTier];
    expect(tiers).not.toContain("emerging");
  });

  it("explainChallengeGap returns NEEDS_HIGHER_TIER for emerging level", () => {
    const criteria: ChallengeCriteria = { requiredTier: "developing", minDistinctSessions: 1, minDistinctCalendarDays: 1 };
    const level = makeLevel({ tier: "emerging" });
    const result = explainChallengeGap(criteria, level);
    expect(result).toContain("NEEDS_HIGHER_TIER");
  });
});
