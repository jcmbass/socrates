import { describe, expect, it } from "vitest";
import {
  MASTERY_TIERS,
  MasteryHistoryEntrySchema,
  MasteryLevelSchema,
  MasteryStateSchema,
  compareMasteryTier,
  projectMasteryVisibility,
  tierToStars,
  type MasteryClientPayload,
  type MasteryHistoryEntry,
  type MasteryLevel,
  type MasteryState,
} from "../mastery";
import { SUBJECT_ROLLUP_TOPIC_KEY } from "../sentinels";

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
    topicKey: "regla-de-la-cadena",
    currentLevel: makeLevel(),
    visibility: "shadow",
    lastHistoryEntryId: "history-1",
    updatedAt: "2026-07-10T10:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

function makeHistoryEntry(overrides: Partial<MasteryHistoryEntry> = {}): MasteryHistoryEntry {
  return {
    id: "history-1",
    userId: "user-1",
    subjectId: "subject-1",
    topicKey: "regla-de-la-cadena",
    level: makeLevel(),
    computedAt: "2026-07-10T10:00:00.000Z",
    computedByVersion: "b2-agg-1",
    contributingAssessmentIds: ["assessment-1"],
    schemaVersion: 1,
    ...overrides,
  };
}

describe("MasteryLevelSchema", () => {
  it("accepts a well-formed emerging level", () => {
    expect(MasteryLevelSchema.safeParse(makeLevel()).success).toBe(true);
  });

  it("accepts up to 6 recentStrongEvidence entries", () => {
    const evidence = Array.from({ length: 6 }, (_, i) => ({
      assessmentId: `a-${i}`,
      sessionId: "session-1",
      timestamp: "2026-07-10T10:00:00.000Z",
    }));
    expect(MasteryLevelSchema.safeParse(makeLevel({ recentStrongEvidence: evidence })).success).toBe(true);
  });

  it("rejects more than 6 recentStrongEvidence entries", () => {
    const evidence = Array.from({ length: 7 }, (_, i) => ({
      assessmentId: `a-${i}`,
      sessionId: "session-1",
      timestamp: "2026-07-10T10:00:00.000Z",
    }));
    expect(MasteryLevelSchema.safeParse(makeLevel({ recentStrongEvidence: evidence })).success).toBe(false);
  });

  it("rejects an unknown tier", () => {
    expect(MasteryLevelSchema.safeParse(makeLevel({ tier: "expert" as never })).success).toBe(false);
  });
});

describe("compareMasteryTier", () => {
  it("orders emerging < developing < consolidated < mastered", () => {
    expect(compareMasteryTier("emerging", "developing")).toBe(-1);
    expect(compareMasteryTier("developing", "consolidated")).toBe(-1);
    expect(compareMasteryTier("consolidated", "mastered")).toBe(-1);
    expect(compareMasteryTier("mastered", "emerging")).toBe(1);
  });

  it("treats equal tiers as equal regardless of auditing counters (B2 §2)", () => {
    expect(compareMasteryTier("developing", "developing")).toBe(0);
  });

  it("covers every tier in MASTERY_TIERS", () => {
    expect(MASTERY_TIERS).toEqual(["emerging", "developing", "consolidated", "mastered"]);
  });
});

describe("MasteryStateSchema", () => {
  it("accepts a well-formed MasteryState", () => {
    expect(MasteryStateSchema.safeParse(makeState()).success).toBe(true);
  });

  it("accepts the subject-rollup sentinel topicKey (I-9)", () => {
    expect(MasteryStateSchema.safeParse(makeState({ topicKey: SUBJECT_ROLLUP_TOPIC_KEY })).success).toBe(true);
  });

  it("rejects an invalid visibility", () => {
    expect(MasteryStateSchema.safeParse(makeState({ visibility: "public" as never })).success).toBe(false);
  });
});

describe("MasteryHistoryEntrySchema", () => {
  it("accepts a well-formed entry", () => {
    expect(MasteryHistoryEntrySchema.safeParse(makeHistoryEntry()).success).toBe(true);
  });

  it("rejects an empty computedByVersion", () => {
    expect(MasteryHistoryEntrySchema.safeParse(makeHistoryEntry({ computedByVersion: "" })).success).toBe(false);
  });
});

describe("topicId extension", () => {
  it("accepts a subject-level MasteryState without topicId", () => {
    expect(MasteryStateSchema.safeParse(makeState({ topicKey: SUBJECT_ROLLUP_TOPIC_KEY })).success).toBe(true);
  });

  it("accepts a topic-scoped MasteryState with a non-empty topicId", () => {
    expect(MasteryStateSchema.safeParse(makeState({ topicId: "topic-uuid-1" })).success).toBe(true);
  });

  it("accepts an explicit null topicId", () => {
    expect(MasteryStateSchema.safeParse(makeState({ topicId: null })).success).toBe(true);
  });

  it("rejects an empty string topicId", () => {
    expect(MasteryStateSchema.safeParse(makeState({ topicId: "" })).success).toBe(false);
  });

  it("accepts a topicId on a MasteryHistoryEntry", () => {
    expect(MasteryHistoryEntrySchema.safeParse(makeHistoryEntry({ topicId: "topic-uuid-1" })).success).toBe(true);
  });
});

describe("byte identity of existing subject-level records", () => {
  it("MasteryState without topicId serializes byte-identically to the pre-extension shape", () => {
    const state = makeState();
    const serialized = JSON.stringify(state);
    const expected =
      '{"id":"mastery-1","userId":"user-1","subjectId":"subject-1","topicKey":"regla-de-la-cadena","currentLevel":{"tier":"emerging","positiveStreak":0,"negativeStreak":0,"strongCount":0,"recentStrongEvidence":[],"lastPositiveAt":null,"lastPromotionAt":null},"visibility":"shadow","lastHistoryEntryId":"history-1","updatedAt":"2026-07-10T10:00:00.000Z","schemaVersion":1}';
    expect(serialized).toBe(expected);
  });

  it("MasteryHistoryEntry without topicId serializes byte-identically to the pre-extension shape", () => {
    const entry = makeHistoryEntry();
    const serialized = JSON.stringify(entry);
    const expected =
      '{"id":"history-1","userId":"user-1","subjectId":"subject-1","topicKey":"regla-de-la-cadena","level":{"tier":"emerging","positiveStreak":0,"negativeStreak":0,"strongCount":0,"recentStrongEvidence":[],"lastPositiveAt":null,"lastPromotionAt":null},"computedAt":"2026-07-10T10:00:00.000Z","computedByVersion":"b2-agg-1","contributingAssessmentIds":["assessment-1"],"schemaVersion":1}';
    expect(serialized).toBe(expected);
  });
});

describe("tierToStars", () => {
  it("maps every tier to its star count", () => {
    expect(tierToStars("emerging")).toBe(0);
    expect(tierToStars("developing")).toBe(1);
    expect(tierToStars("consolidated")).toBe(2);
    expect(tierToStars("mastered")).toBe(3);
  });
});

describe("projectMasteryVisibility", () => {
  const payload: MasteryClientPayload = {
    tier: "developing",
    stars: 1,
    xp: 50,
    historyEntryId: "history-1",
  };

  it("omits stars and xp in shadow mode", () => {
    const projected = projectMasteryVisibility(payload, "shadow");
    expect(projected).not.toHaveProperty("stars");
    expect(projected).not.toHaveProperty("xp");
    expect(projected).toHaveProperty("tier", "developing");
    expect(projected).toHaveProperty("historyEntryId", "history-1");
  });

  it("keeps stars and xp in visible mode", () => {
    const projected = projectMasteryVisibility(payload, "visible");
    expect(projected).toEqual(payload);
  });
});
