import { describe, expect, it } from "vitest";
import {
  DomainInvariantError,
  assertAchievementRetryReferencesRevoked,
  assertAchievementStatusTransition,
  assertAssessmentReferencesExchange,
  assertAssessmentVersionFieldsPresent,
  assertConsentAppendOnly,
  assertCourseGradeLevelEnabledAtCreation,
  assertExchangeComplete,
  assertExchangeImmutable,
  assertExchangeVersionFieldsPresent,
  assertFuenteTextOnly,
  assertHitoCoversWithinTemario,
  assertMasteryHistoryEntryAssessmentsScopedToSubject,
  assertMasteryHistoryEntryImmutable,
  assertMasteryHistoryEntryVersionFieldPresent,
  assertMasteryStateWrittenWithHistoryEntry,
  assertMasteryTopicScopedToSubject,
  assertMaterialAssetStatusTransition,
  assertStarsSetOnlyByAssessor,
  assertTemarioOwnedBySubjectUser,
  assertTopicTitleSanitized,
  assertUsageQuotaCountersNonNegative,
  assertUsageQuotaUnique,
  assertXpOnlyFromAssessment,
} from "../invariants";
import type { Assessment } from "../assessment";
import type { Exchange } from "../exchange";
import type { MasteryHistoryEntry, MasteryLevel, MasteryState } from "../mastery";
import type { Consent } from "../consent";
import type { Course } from "../course";
import type { GradeLevel } from "../education-catalog";
import type { UsageQuota } from "../usage-quota";
import type { Achievement } from "../gamification";
import type { Fuente } from "../fuente";
import type { Hito, Tema, Temario } from "../temario";
import type { XpEvent } from "../xp";

const TS = "2026-07-10T10:00:00.000Z";
const TS_LATER = "2026-07-11T10:00:00.000Z";

function makeExchange(overrides: Partial<Exchange> = {}): Exchange {
  return {
    id: "session-1:0",
    sessionId: "session-1",
    index: 0,
    timestamp: TS,
    studentMessage: "No entiendo.",
    tutorReply: "¿Qué parte te confunde?",
    band: "guiding",
    tutorPromptVersion: "buxo-socratic-v3",
    tutorModelId: "claude-sonnet-5",
    tutorProviderId: "anthropic-direct",
    hintOffered: null,
    studentCorrect: null,
    judgePromptVersion: null,
    judgeModelId: null,
    judgeProviderId: null,
    schemaVersion: 1,
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: "assessment-1",
    sessionId: "session-1",
    exchangeId: "session-1:0",
    subjectId: "subject-1",
    timestamp: TS,
    demonstratedUnderstanding: "developing",
    explainedInOwnWords: true,
    guessedOrPatternMatched: false,
    recommendedBand: "probing",
    rationale: "x",
    topicKey: "tema-1",
    assessorPromptVersion: "assessor-v1",
    assessorModelId: "claude-sonnet-5",
    assessorProviderId: "anthropic-direct",
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

function makeState(overrides: Partial<MasteryState> = {}): MasteryState {
  return {
    id: "mastery-1",
    userId: "user-1",
    subjectId: "subject-1",
    topicKey: "tema-1",
    currentLevel: makeLevel(),
    visibility: "shadow",
    lastHistoryEntryId: "history-1",
    updatedAt: TS,
    schemaVersion: 1,
    ...overrides,
  };
}

function makeHistoryEntry(overrides: Partial<MasteryHistoryEntry> = {}): MasteryHistoryEntry {
  return {
    id: "history-1",
    userId: "user-1",
    subjectId: "subject-1",
    topicKey: "tema-1",
    level: makeLevel(),
    computedAt: TS,
    computedByVersion: "b2-agg-1",
    contributingAssessmentIds: ["assessment-1"],
    schemaVersion: 1,
    ...overrides,
  };
}

function makeTemario(overrides: Partial<Temario> = {}): Temario {
  return {
    id: "temario-1",
    subjectId: "subject-1",
    userId: "user-1",
    topics: [],
    milestones: [],
    generatedBy: "manual",
    createdAt: TS,
    updatedAt: TS,
    schemaVersion: 1,
    ...overrides,
  };
}

function makeTopic(overrides: Partial<Tema> = {}): Tema {
  return {
    id: "topic-1",
    temarioId: "temario-1",
    order: 0,
    title: "Límites",
    status: "new",
    stars: 0,
    recommended: false,
    unitLabel: null,
    schemaVersion: 1,
    ...overrides,
  };
}

function makeMilestone(overrides: Partial<Hito> = {}): Hito {
  return {
    id: "hito-1",
    temarioId: "temario-1",
    order: 1,
    kind: "parcial",
    title: "Parcial 1",
    coversUpToOrder: 0,
    status: "available",
    schemaVersion: 1,
    ...overrides,
  };
}

function makeFuente(overrides: Partial<Fuente> = {}): Fuente {
  return {
    id: "fuente-1",
    subjectId: "subject-1",
    userId: "user-1",
    name: "Guía.pdf",
    kind: "pdf",
    text: "texto",
    createdAt: TS,
    schemaVersion: 1,
    ...overrides,
  };
}

function makeXpEvent(overrides: Partial<XpEvent> = {}): XpEvent {
  return {
    id: "xp-1",
    userId: "user-1",
    subjectId: "subject-1",
    topicId: "topic-1",
    delta: 100,
    reason: "tier_promoted",
    assessmentRef: { assessmentId: "assessment-1", sessionId: "session-1" },
    createdAt: TS,
    schemaVersion: 1,
    ...overrides,
  };
}

describe("I-1 assertAssessmentReferencesExchange", () => {
  it("passes when exchangeId and sessionId both match", () => {
    expect(() => assertAssessmentReferencesExchange(makeAssessment(), makeExchange())).not.toThrow();
  });

  it("throws when exchangeId doesn't match", () => {
    expect(() =>
      assertAssessmentReferencesExchange(makeAssessment({ exchangeId: "other:0" }), makeExchange()),
    ).toThrow(DomainInvariantError);
  });

  it("throws when sessionId doesn't match (cross-session Exchange)", () => {
    expect(() =>
      assertAssessmentReferencesExchange(makeAssessment(), makeExchange({ sessionId: "session-2" })),
    ).toThrow(DomainInvariantError);
  });
});

describe("I-2 assertMasteryStateWrittenWithHistoryEntry", () => {
  it("passes when the state and its history entry are consistent", () => {
    expect(() => assertMasteryStateWrittenWithHistoryEntry(makeState(), makeHistoryEntry())).not.toThrow();
  });

  it("throws when lastHistoryEntryId doesn't point at the entry", () => {
    expect(() =>
      assertMasteryStateWrittenWithHistoryEntry(makeState({ lastHistoryEntryId: "history-2" }), makeHistoryEntry()),
    ).toThrow(DomainInvariantError);
  });

  it("throws when currentLevel diverges from the history entry's level", () => {
    expect(() =>
      assertMasteryStateWrittenWithHistoryEntry(
        makeState({ currentLevel: makeLevel({ tier: "developing" }) }),
        makeHistoryEntry(),
      ),
    ).toThrow(DomainInvariantError);
  });

  it("throws when the (userId, subjectId, topicKey) identity diverges", () => {
    expect(() =>
      assertMasteryStateWrittenWithHistoryEntry(makeState({ topicKey: "otro-tema" }), makeHistoryEntry()),
    ).toThrow(DomainInvariantError);
  });
});

describe("I-3 assertMasteryHistoryEntryImmutable", () => {
  it("passes when the two entries (same id) are identical", () => {
    const entry = makeHistoryEntry();
    expect(() => assertMasteryHistoryEntryImmutable(entry, { ...entry })).not.toThrow();
  });

  it("throws when a field changed on the same id (append-only violation)", () => {
    const entry = makeHistoryEntry();
    expect(() =>
      assertMasteryHistoryEntryImmutable(entry, { ...entry, level: makeLevel({ tier: "mastered" }) }),
    ).toThrow(DomainInvariantError);
  });

  it("throws (misuse) when called with two different ids", () => {
    expect(() =>
      assertMasteryHistoryEntryImmutable(makeHistoryEntry({ id: "a" }), makeHistoryEntry({ id: "b" })),
    ).toThrow(DomainInvariantError);
  });
});

describe("I-4 assertExchangeImmutable", () => {
  it("passes when nothing frozen changed and a judge verdict settles from null", () => {
    const previous = makeExchange();
    const next = makeExchange({
      hintOffered: true,
      studentCorrect: false,
      judgePromptVersion: "judge-v2",
      judgeModelId: "claude-haiku-5",
      judgeProviderId: "anthropic-direct",
    });
    expect(() => assertExchangeImmutable(previous, next)).not.toThrow();
  });

  it("throws when studentMessage is edited", () => {
    const previous = makeExchange();
    expect(() => assertExchangeImmutable(previous, { ...previous, studentMessage: "edited" })).toThrow(
      DomainInvariantError,
    );
  });

  it("throws when band is edited", () => {
    const previous = makeExchange();
    expect(() => assertExchangeImmutable(previous, { ...previous, band: "minimal" })).toThrow(DomainInvariantError);
  });

  it("throws when an already-non-null judge verdict is overwritten", () => {
    const previous = makeExchange({ studentCorrect: true });
    expect(() => assertExchangeImmutable(previous, { ...previous, studentCorrect: false })).toThrow(
      DomainInvariantError,
    );
  });

  it("passes when an already-non-null judge field is written with the same value again", () => {
    const previous = makeExchange({ studentCorrect: true });
    expect(() => assertExchangeImmutable(previous, { ...previous, studentCorrect: true })).not.toThrow();
  });
});

describe("I-5 version field presence", () => {
  it("assertExchangeVersionFieldsPresent passes with tutor fields set and judge fields all-null", () => {
    expect(() => assertExchangeVersionFieldsPresent(makeExchange())).not.toThrow();
  });

  it("assertExchangeVersionFieldsPresent passes with judge fields all-present", () => {
    expect(() =>
      assertExchangeVersionFieldsPresent(
        makeExchange({ judgePromptVersion: "judge-v2", judgeModelId: "x", judgeProviderId: "x" }),
      ),
    ).not.toThrow();
  });

  it("assertExchangeVersionFieldsPresent throws when tutorModelId is empty", () => {
    expect(() => assertExchangeVersionFieldsPresent(makeExchange({ tutorModelId: "" }))).toThrow(
      DomainInvariantError,
    );
  });

  it("assertExchangeVersionFieldsPresent throws when judge fields are partially set", () => {
    expect(() =>
      assertExchangeVersionFieldsPresent(makeExchange({ judgePromptVersion: "judge-v2" })),
    ).toThrow(DomainInvariantError);
  });

  it("assertAssessmentVersionFieldsPresent throws on an empty assessorProviderId", () => {
    expect(() => assertAssessmentVersionFieldsPresent(makeAssessment({ assessorProviderId: "" }))).toThrow(
      DomainInvariantError,
    );
  });

  it("assertMasteryHistoryEntryVersionFieldPresent throws on an empty computedByVersion", () => {
    expect(() =>
      assertMasteryHistoryEntryVersionFieldPresent(makeHistoryEntry({ computedByVersion: "" })),
    ).toThrow(DomainInvariantError);
  });
});

describe("I-6 assertConsentAppendOnly", () => {
  const accepted: Consent = {
    id: "consent-1",
    userId: "user-1",
    type: "terms_13plus",
    status: "accepted",
    policyVersion: "1",
    occurredAt: TS,
    schemaVersion: 1,
  };

  it("passes for a fresh acceptance with no prior history", () => {
    expect(() => assertConsentAppendOnly([], accepted)).not.toThrow();
  });

  it("passes for a withdrawal that has a prior acceptance", () => {
    const withdrawal: Consent = { ...accepted, id: "consent-2", status: "withdrawn", occurredAt: TS_LATER };
    expect(() => assertConsentAppendOnly([accepted], withdrawal)).not.toThrow();
  });

  it("throws for a withdrawal with no prior acceptance", () => {
    const withdrawal: Consent = { ...accepted, id: "consent-2", status: "withdrawn" };
    expect(() => assertConsentAppendOnly([], withdrawal)).toThrow(DomainInvariantError);
  });

  it("throws when the candidate id already exists (attempted overwrite)", () => {
    expect(() => assertConsentAppendOnly([accepted], accepted)).toThrow(DomainInvariantError);
  });
});

describe("I-7 assertCourseGradeLevelEnabledAtCreation", () => {
  const enabledGrade: GradeLevel = {
    id: "sv-bachillerato-1",
    systemId: "sv",
    stageId: "sv-bachillerato",
    order: 1,
    labelKey: "x",
    defaultLabel: "x",
    typicalAgeMin: 15,
    typicalAgeMax: 16,
    enabled: true,
    schemaVersion: 1,
  };
  const course: Course = {
    id: "course-1",
    userId: "user-1",
    gradeLevelId: "sv-bachillerato-1",
    customLabel: null,
    academicYear: 2026,
    status: "active",
    createdAt: TS,
    updatedAt: TS,
    schemaVersion: 1,
  };

  it("passes for a Course pointed at an enabled GradeLevel", () => {
    expect(() => assertCourseGradeLevelEnabledAtCreation(course, enabledGrade)).not.toThrow();
  });

  it("throws for a disabled GradeLevel (e.g. básica, O-13)", () => {
    expect(() =>
      assertCourseGradeLevelEnabledAtCreation(course, { ...enabledGrade, enabled: false }),
    ).toThrow(DomainInvariantError);
  });

  it("throws when the ids don't match", () => {
    expect(() =>
      assertCourseGradeLevelEnabledAtCreation(course, { ...enabledGrade, id: "sv-bachillerato-2" }),
    ).toThrow(DomainInvariantError);
  });
});

describe("I-8 assertMaterialAssetStatusTransition", () => {
  it("allows pending -> digesting", () => {
    expect(() => assertMaterialAssetStatusTransition("pending", "digesting")).not.toThrow();
  });

  it("allows digesting -> ready | partial | failed", () => {
    expect(() => assertMaterialAssetStatusTransition("digesting", "ready")).not.toThrow();
    expect(() => assertMaterialAssetStatusTransition("digesting", "partial")).not.toThrow();
    expect(() => assertMaterialAssetStatusTransition("digesting", "failed")).not.toThrow();
  });

  it("rejects skipping straight from pending to ready", () => {
    expect(() => assertMaterialAssetStatusTransition("pending", "ready")).toThrow(DomainInvariantError);
  });

  it("rejects any transition out of a terminal status", () => {
    expect(() => assertMaterialAssetStatusTransition("ready", "digesting")).toThrow(DomainInvariantError);
    expect(() => assertMaterialAssetStatusTransition("failed", "pending")).toThrow(DomainInvariantError);
  });
});

describe("I-9 assertMasteryHistoryEntryAssessmentsScopedToSubject", () => {
  it("passes when every contributing assessment shares the entry's subjectId", () => {
    expect(() =>
      assertMasteryHistoryEntryAssessmentsScopedToSubject(makeHistoryEntry(), [makeAssessment()]),
    ).not.toThrow();
  });

  it("throws when a contributing assessment belongs to a different subject", () => {
    expect(() =>
      assertMasteryHistoryEntryAssessmentsScopedToSubject(makeHistoryEntry(), [
        makeAssessment({ subjectId: "subject-2" }),
      ]),
    ).toThrow(DomainInvariantError);
  });

  it("throws when a referenced assessment is missing", () => {
    expect(() => assertMasteryHistoryEntryAssessmentsScopedToSubject(makeHistoryEntry(), [])).toThrow(
      DomainInvariantError,
    );
  });
});

describe("I-10 UsageQuota", () => {
  const quota: UsageQuota = {
    id: "quota-1",
    userId: "user-1",
    period: "daily",
    periodKey: "2026-07-12",
    tutorMessagesUsed: 5,
    assessorCallsUsed: 1,
    judgeCallsUsed: 1,
    ingestCloudCallsUsed: 0,
    costUsdEstimate: 0.1,
    costUsdIncomplete: false,
    capTutorMessages: 50,
    capCostUsd: 1,
    resetAt: TS_LATER,
    schemaVersion: 1,
  };

  it("assertUsageQuotaUnique passes with no duplicates", () => {
    expect(() => assertUsageQuotaUnique([quota, { ...quota, id: "quota-2", periodKey: "2026-07-13" }])).not.toThrow();
  });

  it("assertUsageQuotaUnique throws on a duplicate (userId, period, periodKey)", () => {
    expect(() => assertUsageQuotaUnique([quota, { ...quota, id: "quota-2" }])).toThrow(DomainInvariantError);
  });

  it("assertUsageQuotaCountersNonNegative passes for non-negative counters", () => {
    expect(() => assertUsageQuotaCountersNonNegative(quota)).not.toThrow();
  });

  it("assertUsageQuotaCountersNonNegative throws for a negative counter", () => {
    expect(() => assertUsageQuotaCountersNonNegative({ ...quota, tutorMessagesUsed: -1 })).toThrow(
      DomainInvariantError,
    );
  });
});

describe("I-11 Achievement", () => {
  const earned: Achievement = {
    id: "achievement-1",
    userId: "user-1",
    challengeDefinitionId: "challenge-1",
    challengeDefinitionVersion: "1",
    subjectId: "subject-1",
    topicKey: "tema-1",
    earnedAt: TS,
    status: "earned",
    revokedAt: null,
    revokedReason: null,
    evidenceAssessmentIds: ["assessment-1"],
    retryOf: null,
    schemaVersion: 1,
  };
  const revoked: Achievement = { ...earned, status: "revoked", revokedAt: TS_LATER, revokedReason: "farmeo" };

  it("allows earned -> revoked", () => {
    expect(() => assertAchievementStatusTransition("earned", "revoked")).not.toThrow();
  });

  it("rejects revoked -> earned (must create a new row with retryOf instead)", () => {
    expect(() => assertAchievementStatusTransition("revoked", "earned")).toThrow(DomainInvariantError);
  });

  it("assertAchievementRetryReferencesRevoked passes when retryOf points at a revoked row", () => {
    const retry: Achievement = { ...earned, id: "achievement-2", retryOf: revoked.id };
    expect(() => assertAchievementRetryReferencesRevoked([revoked], retry)).not.toThrow();
  });

  it("assertAchievementRetryReferencesRevoked throws when retryOf points at a still-earned row", () => {
    const retry: Achievement = { ...earned, id: "achievement-2", retryOf: earned.id };
    expect(() => assertAchievementRetryReferencesRevoked([earned], retry)).toThrow(DomainInvariantError);
  });

  it("assertAchievementRetryReferencesRevoked throws when the referenced row doesn't exist", () => {
    const retry: Achievement = { ...earned, id: "achievement-2", retryOf: "does-not-exist" };
    expect(() => assertAchievementRetryReferencesRevoked([], retry)).toThrow(DomainInvariantError);
  });

  it("assertAchievementRetryReferencesRevoked is a no-op when retryOf is null", () => {
    expect(() => assertAchievementRetryReferencesRevoked([], earned)).not.toThrow();
  });
});

describe("I-12 assertExchangeComplete", () => {
  it("passes when both messages are present", () => {
    expect(() =>
      assertExchangeComplete({ studentMessage: "hola", tutorReply: "¿qué intentaste?" }),
    ).not.toThrow();
  });

  it("throws when studentMessage is empty (a streaming/interrupted turn is not an Exchange)", () => {
    expect(() => assertExchangeComplete({ studentMessage: "", tutorReply: "x" })).toThrow(DomainInvariantError);
  });

  it("throws when tutorReply is only whitespace", () => {
    expect(() => assertExchangeComplete({ studentMessage: "x", tutorReply: "   " })).toThrow(DomainInvariantError);
  });
});

// ---------------------------------------------------------------------------
// P0 invariants
// ---------------------------------------------------------------------------

describe("P0-1 assertTemarioOwnedBySubjectUser", () => {
  it("passes when subject and user match", () => {
    expect(() => assertTemarioOwnedBySubjectUser(makeTemario(), "subject-1", "user-1")).not.toThrow();
  });

  it("throws when subjectId differs", () => {
    expect(() => assertTemarioOwnedBySubjectUser(makeTemario(), "subject-2", "user-1")).toThrow(
      DomainInvariantError,
    );
  });

  it("throws when userId differs", () => {
    expect(() => assertTemarioOwnedBySubjectUser(makeTemario(), "subject-1", "user-2")).toThrow(
      DomainInvariantError,
    );
  });
});

describe("P0-2 assertTopicTitleSanitized", () => {
  it("passes for a sanitized title", () => {
    expect(() => assertTopicTitleSanitized("Límites y continuidad")).not.toThrow();
  });

  it("throws for a title with control characters", () => {
    expect(() => assertTopicTitleSanitized("Tema\ncon\tsaltos")).toThrow(DomainInvariantError);
  });

  it("throws for a title longer than 60 chars", () => {
    expect(() => assertTopicTitleSanitized("a".repeat(61))).toThrow(DomainInvariantError);
  });
});

describe("P0-3 assertStarsSetOnlyByAssessor", () => {
  it("passes for a client-written topic with zero stars and new status", () => {
    expect(() => assertStarsSetOnlyByAssessor(makeTopic(), "client")).not.toThrow();
  });

  it("throws when a client tries to set stars", () => {
    expect(() => assertStarsSetOnlyByAssessor(makeTopic({ stars: 2 }), "client")).toThrow(DomainInvariantError);
  });

  it("throws when a client tries to mark done", () => {
    expect(() => assertStarsSetOnlyByAssessor(makeTopic({ status: "done" }), "client")).toThrow(
      DomainInvariantError,
    );
  });

  it("passes when the assessor writes stars and done", () => {
    expect(() => assertStarsSetOnlyByAssessor(makeTopic({ status: "done", stars: 3 }), "assessor")).not.toThrow();
  });
});

describe("P0-4 assertMasteryTopicScopedToSubject", () => {
  it("passes for a subject-level rollup (no topicId)", () => {
    expect(() => assertMasteryTopicScopedToSubject(makeHistoryEntry(), new Set())).not.toThrow();
  });

  it("passes when the topicId exists in the temario", () => {
    expect(() =>
      assertMasteryTopicScopedToSubject(makeHistoryEntry({ topicId: "topic-a" }), new Set(["topic-a", "topic-b"])),
    ).not.toThrow();
  });

  it("throws when the topicId is not in the subject temario", () => {
    expect(() =>
      assertMasteryTopicScopedToSubject(makeHistoryEntry({ topicId: "topic-x" }), new Set(["topic-a"])),
    ).toThrow(DomainInvariantError);
  });
});

describe("P0-5 assertHitoCoversWithinTemario", () => {
  it("passes when coversUpToOrder is within bounds", () => {
    expect(() => assertHitoCoversWithinTemario(makeMilestone({ coversUpToOrder: 2 }), 4)).not.toThrow();
  });

  it("passes at the exact boundary", () => {
    expect(() => assertHitoCoversWithinTemario(makeMilestone({ coversUpToOrder: 4 }), 4)).not.toThrow();
  });

  it("throws when coversUpToOrder exceeds the last topic order", () => {
    expect(() => assertHitoCoversWithinTemario(makeMilestone({ coversUpToOrder: 5 }), 4)).toThrow(
      DomainInvariantError,
    );
  });
});

describe("P0-6 assertFuenteTextOnly", () => {
  it("passes for a plain text Fuente", () => {
    expect(() => assertFuenteTextOnly(makeFuente())).not.toThrow();
  });

  it("throws when a binary/storage field is attached", () => {
    const fuente = { ...makeFuente(), storageUrl: "https://example.com/blob" } as unknown as Fuente;
    expect(() => assertFuenteTextOnly(fuente)).toThrow(DomainInvariantError);
  });
});

describe("P0-7 assertXpOnlyFromAssessment", () => {
  it("passes when the event references an assessment", () => {
    expect(() => assertXpOnlyFromAssessment(makeXpEvent())).not.toThrow();
  });

  it("throws when a non-guided event has no assessmentRef", () => {
    expect(() => assertXpOnlyFromAssessment(makeXpEvent({ assessmentRef: null }))).toThrow(
      DomainInvariantError,
    );
  });

  it("throws when the assessmentId is empty", () => {
    expect(() =>
      assertXpOnlyFromAssessment(makeXpEvent({ assessmentRef: { assessmentId: "", sessionId: "s1" } })),
    ).toThrow(DomainInvariantError);
  });

  it("passes for guided reasons with null assessmentRef", () => {
    expect(() =>
      assertXpOnlyFromAssessment(
        makeXpEvent({ reason: "guided_item_correct", delta: 10, assessmentRef: null }),
      ),
    ).not.toThrow();
    expect(() =>
      assertXpOnlyFromAssessment(
        makeXpEvent({ reason: "guided_session_complete", delta: 25, assessmentRef: null }),
      ),
    ).not.toThrow();
  });

  it("throws when a guided reason carries an assessmentRef", () => {
    expect(() =>
      assertXpOnlyFromAssessment(
        makeXpEvent({ reason: "guided_item_retry", delta: 5, assessmentRef: { assessmentId: "a", sessionId: "s" } }),
      ),
    ).toThrow(DomainInvariantError);
  });
});
