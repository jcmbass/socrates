import { describe, expect, it } from "vitest";
import {
  XP_PER_TIER_INCREMENT,
  XP_GUIDED_CORRECT,
  XP_GUIDED_RETRY,
  XP_GUIDED_SESSION,
  XP_REASONS,
  XpEventSchema,
  accrueXp,
  deserializeXpEvent,
  emptyXpEvent,
  evidenceXpFromVerdict,
  guidedItemXp,
  guidedSessionXp,
  parseXpEvent,
  serializeXpEvent,
  xpReasonForTierChange,
  type XpEvent,
} from "../xp";

const TS = "2026-07-21T10:00:00.000Z";
const NOW = new Date(TS);

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

describe("XpEventSchema", () => {
  it("accepts a well-formed XpEvent", () => {
    expect(XpEventSchema.safeParse(makeXpEvent()).success).toBe(true);
  });

  it("accepts a subject-level event without topicId", () => {
    expect(XpEventSchema.safeParse(makeXpEvent({ topicId: undefined })).success).toBe(true);
  });

  it("rejects an invalid reason", () => {
    expect(XpEventSchema.safeParse(makeXpEvent({ reason: "bonus" as never })).success).toBe(false);
  });

  it("rejects a missing assessmentRef for assessment-driven reasons", () => {
    expect(XpEventSchema.safeParse(makeXpEvent({ assessmentRef: null })).success).toBe(false);
  });

  it("accepts null assessmentRef for guided reasons", () => {
    expect(
      XpEventSchema.safeParse(
        makeXpEvent({ reason: "guided_item_correct", delta: 10, assessmentRef: null }),
      ).success,
    ).toBe(true);
  });

  it("rejects a fractional delta", () => {
    expect(XpEventSchema.safeParse(makeXpEvent({ delta: 12.5 })).success).toBe(false);
  });
});

describe("accrueXp", () => {
  it("returns zero when the tier does not change", () => {
    expect(accrueXp("emerging", "emerging")).toBe(0);
    expect(accrueXp("mastered", "mastered")).toBe(0);
  });

  it("awards positive XP for promotions", () => {
    expect(accrueXp("emerging", "developing")).toBe(XP_PER_TIER_INCREMENT);
    expect(accrueXp("developing", "mastered")).toBe(XP_PER_TIER_INCREMENT * 2);
  });

  it("deducts XP for demotions", () => {
    expect(accrueXp("consolidated", "developing")).toBe(-XP_PER_TIER_INCREMENT);
    expect(accrueXp("mastered", "emerging")).toBe(-XP_PER_TIER_INCREMENT * 3);
  });

  it("is deterministic", () => {
    expect(accrueXp("emerging", "consolidated")).toBe(accrueXp("emerging", "consolidated"));
  });
});

describe("xpReasonForTierChange", () => {
  it("maps tier changes to reason keys", () => {
    expect(xpReasonForTierChange("emerging", "developing")).toBe("tier_promoted");
    expect(xpReasonForTierChange("developing", "emerging")).toBe("tier_demoted");
    expect(xpReasonForTierChange("consolidated", "consolidated")).toBe("tier_unchanged");
  });

  it("uses only the documented reason keys", () => {
    expect(XP_REASONS).toContain(xpReasonForTierChange("mastered", "emerging"));
  });
});

describe("emptyXpEvent factory", () => {
  it("builds an event referencing its assessment", () => {
    const event = emptyXpEvent({
      userId: "u1",
      subjectId: "s1",
      delta: 100,
      reason: "tier_promoted",
      assessmentRef: { assessmentId: "a1", sessionId: "s1" },
      now: NOW,
    });
    expect(event.userId).toBe("u1");
    expect(event.assessmentRef?.assessmentId).toBe("a1");
    expect(event.createdAt).toBe(TS);
  });
});

describe("guidedItemXp", () => {
  it("awards full XP on first attempt", () => {
    expect(guidedItemXp(1)).toEqual({ delta: XP_GUIDED_CORRECT, reason: "guided_item_correct" });
  });

  it("awards retry XP on second attempt", () => {
    expect(guidedItemXp(2)).toEqual({ delta: XP_GUIDED_RETRY, reason: "guided_item_retry" });
  });
});

describe("guidedSessionXp", () => {
  it("returns the session completion bonus", () => {
    expect(guidedSessionXp()).toEqual({ delta: XP_GUIDED_SESSION, reason: "guided_session_complete" });
  });

  it("uses documented reason keys", () => {
    expect(XP_REASONS).toContain(guidedSessionXp().reason);
  });
});

describe("Serialization round-trip", () => {
  it("round-trips a full XpEvent", () => {
    const event = makeXpEvent();
    const restored = parseXpEvent(JSON.parse(serializeXpEvent(event)));
    expect(restored).toEqual(event);
  });

  it("round-trips an event without optional scopes", () => {
    const event = makeXpEvent({ subjectId: undefined, topicId: undefined });
    const restored = parseXpEvent(JSON.parse(serializeXpEvent(event)));
    expect(restored).toEqual(event);
  });

  it("deserializeXpEvent rejects malformed JSON", () => {
    expect(() => deserializeXpEvent("not-json")).toThrow();
  });
});

describe("evidenceXpFromVerdict", () => {
  it("returns null (no XP) when guessedOrPatternMatched, even if solid", () => {
    expect(
      evidenceXpFromVerdict({
        demonstratedUnderstanding: "solid",
        explainedInOwnWords: true,
        guessedOrPatternMatched: true,
      }),
    ).toBeNull();
  });

  it("returns null for none/weak", () => {
    expect(
      evidenceXpFromVerdict({
        demonstratedUnderstanding: "none",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
      }),
    ).toBeNull();
    expect(
      evidenceXpFromVerdict({
        demonstratedUnderstanding: "weak",
        explainedInOwnWords: false,
        guessedOrPatternMatched: false,
      }),
    ).toBeNull();
  });

  it("developing + explainedInOwnWords = 3", () => {
    expect(
      evidenceXpFromVerdict({
        demonstratedUnderstanding: "developing",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
      }),
    ).toEqual({ delta: 3, reason: "evidence_developing_own_words" });
  });

  it("solid + explainedInOwnWords = 4", () => {
    expect(
      evidenceXpFromVerdict({
        demonstratedUnderstanding: "solid",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
      }),
    ).toEqual({ delta: 4, reason: "evidence_solid_own_words" });
  });

  it("developing without own words = 2; solid without = 3", () => {
    expect(
      evidenceXpFromVerdict({
        demonstratedUnderstanding: "developing",
        explainedInOwnWords: false,
        guessedOrPatternMatched: false,
      }),
    ).toEqual({ delta: 2, reason: "evidence_developing" });
    expect(
      evidenceXpFromVerdict({
        demonstratedUnderstanding: "solid",
        explainedInOwnWords: false,
        guessedOrPatternMatched: false,
      }),
    ).toEqual({ delta: 3, reason: "evidence_solid" });
  });
});
