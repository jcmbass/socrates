import { describe, expect, it } from "vitest";
import type { Assessment } from "../assessment";
import type { MasteryLevel } from "../mastery";
import {
  DEFAULT_MASTERY_AGGREGATION_CONFIG,
  B2_AGGREGATION_VERSION,
  aggregate,
  applyDecay,
  classifySignal,
  foldMasteryLevel,
  normalizeTopicLabel,
} from "../mastery-engine";

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

/** demonstratedUnderstanding "developing" + explained + not guessed -> classifySignal "positive" (not "strong"). */
function positiveAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return makeAssessment({ demonstratedUnderstanding: "developing", explainedInOwnWords: true, guessedOrPatternMatched: false, ...overrides });
}

/** demonstratedUnderstanding "solid" + explained + not guessed -> classifySignal "strongPositive". */
function strongAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return makeAssessment({ demonstratedUnderstanding: "solid", explainedInOwnWords: true, guessedOrPatternMatched: false, ...overrides });
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

describe("classifySignal (B2 §1.2)", () => {
  it("solid + explained + not guessed -> strongPositive", () => {
    expect(classifySignal(strongAssessment())).toBe("strongPositive");
  });

  it("developing + explained + not guessed -> positive (not strong)", () => {
    expect(classifySignal(positiveAssessment())).toBe("positive");
  });

  it("none/weak understanding -> negative even if explained and not guessed", () => {
    expect(classifySignal(makeAssessment({ demonstratedUnderstanding: "none", explainedInOwnWords: true, guessedOrPatternMatched: false }))).toBe(
      "negative",
    );
    expect(classifySignal(makeAssessment({ demonstratedUnderstanding: "weak", explainedInOwnWords: true, guessedOrPatternMatched: false }))).toBe(
      "negative",
    );
  });

  it("deliberate note: explainedInOwnWords === false is negative EVEN WHEN understanding is 'solid'", () => {
    expect(
      classifySignal(makeAssessment({ demonstratedUnderstanding: "solid", explainedInOwnWords: false, guessedOrPatternMatched: false })),
    ).toBe("negative");
  });

  it("guessedOrPatternMatched === true is always negative, regardless of understanding", () => {
    expect(
      classifySignal(makeAssessment({ demonstratedUnderstanding: "solid", explainedInOwnWords: true, guessedOrPatternMatched: true })),
    ).toBe("negative");
  });
});

describe("aggregate — full trajectory emerging -> developing -> consolidated -> mastered (B2 §1.3-§1.4)", () => {
  it("walks the whole trajectory across distinct sessions/days, one tier step per Assessment", () => {
    const assessments: Assessment[] = [
      positiveAssessment({ id: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" }),
      positiveAssessment({ id: "a2", sessionId: "s1", timestamp: "2026-01-01T10:05:00.000Z" }),
      positiveAssessment({ id: "a3", sessionId: "s1", timestamp: "2026-01-01T10:10:00.000Z" }),
      strongAssessment({ id: "a4", sessionId: "s1", timestamp: "2026-01-01T10:15:00.000Z" }),
      strongAssessment({ id: "a5", sessionId: "s1", timestamp: "2026-01-01T10:20:00.000Z" }),
      strongAssessment({ id: "a6", sessionId: "s1", timestamp: "2026-01-01T10:25:00.000Z" }),
      strongAssessment({ id: "a7", sessionId: "s2", timestamp: "2026-01-02T09:00:00.000Z" }),
      strongAssessment({ id: "a8", sessionId: "s2", timestamp: "2026-01-02T09:05:00.000Z" }),
      strongAssessment({ id: "a9", sessionId: "s3", timestamp: "2026-01-06T09:00:00.000Z" }),
    ];

    let level: MasteryLevel | null = null;
    const tiersAfterEach: string[] = [];
    for (const a of assessments) {
      level = aggregate(level, a);
      tiersAfterEach.push(level.tier);
    }

    // emerging (a1,a2) -> developing (a3) -> still developing (a4,a5,a6: only 1 distinct session) ->
    // consolidated (a7: 2nd distinct session) -> still consolidated (a8: strongCount reset, too soon) ->
    // mastered (a9: >=3 days after the consolidated promotion, 2nd distinct session since reset).
    expect(tiersAfterEach).toEqual([
      "emerging",
      "emerging",
      "developing",
      "developing",
      "developing",
      "developing",
      "consolidated",
      "consolidated",
      "mastered",
    ]);
    expect(level).not.toBeNull();
    expect(level!.tier).toBe("mastered");
    expect(level!.lastPromotionAt).toBe("2026-01-06T09:00:00.000Z");
  });

  it("matches foldMasteryLevel replaying the same sequence from null", () => {
    const assessments: Assessment[] = [
      positiveAssessment({ id: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" }),
      positiveAssessment({ id: "a2", sessionId: "s1", timestamp: "2026-01-01T10:05:00.000Z" }),
      positiveAssessment({ id: "a3", sessionId: "s1", timestamp: "2026-01-01T10:10:00.000Z" }),
    ];
    const folded = foldMasteryLevel(assessments);
    expect(folded?.tier).toBe("developing");
  });
});

describe("aggregate — a single excellent explanation does NOT promote (fase 4 calibration observation)", () => {
  it("one strongPositive from null materializes 'emerging', never skips ahead", () => {
    const level = aggregate(null, strongAssessment({ id: "a1" }));
    expect(level.tier).toBe("emerging");
    expect(level.positiveStreak).toBe(1);
    expect(level.strongCount).toBe(1);
    expect(level.recentStrongEvidence).toHaveLength(1);
  });

  it("prev === null always materializes at 'emerging', even for a negative signal", () => {
    const level = aggregate(null, makeAssessment({ demonstratedUnderstanding: "none", explainedInOwnWords: false, guessedOrPatternMatched: true }));
    expect(level.tier).toBe("emerging");
    expect(level.negativeStreak).toBe(1);
  });
});

describe("aggregate — one-Assessment clamp: at most one tier step, even if multiple thresholds would otherwise be crossed at once", () => {
  it("a call that simultaneously satisfies the developing AND consolidated thresholds only promotes ONE step", () => {
    // Primed one signal short of BOTH thresholds: positiveStreak=2 (needs 3),
    // strongCount=2 across 2 distinct sessions already (needs 3 strong +
    // 2 sessions for consolidated) — one more strongPositive would cross
    // BOTH the "developing" and "consolidated" conditions in a naive
    // re-evaluation, but the reducer only evaluates tier transitions
    // against the tier the call STARTED at.
    const prev = makeLevel({
      tier: "emerging",
      positiveStreak: 2,
      strongCount: 2,
      recentStrongEvidence: [
        { assessmentId: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" },
        { assessmentId: "a2", sessionId: "s2", timestamp: "2026-01-02T10:00:00.000Z" },
      ],
      lastPositiveAt: "2026-01-02T10:00:00.000Z",
    });

    const next = aggregate(prev, strongAssessment({ id: "a3", sessionId: "s3", timestamp: "2026-01-03T10:00:00.000Z" }));

    expect(next.tier).toBe("developing"); // NOT "consolidated"
    expect(next.strongCount).toBe(0); // reset by the "emerging -> developing" branch
    expect(next.recentStrongEvidence).toEqual([]);
  });
});

describe("aggregate — demotion: 2 consecutive negatives required, never 1; resets counters; floors at emerging", () => {
  function developingLevelWithEvidence(): MasteryLevel {
    return makeLevel({
      tier: "developing",
      positiveStreak: 3,
      strongCount: 2,
      recentStrongEvidence: [{ assessmentId: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" }],
      lastPositiveAt: "2026-01-01T10:00:00.000Z",
    });
  }

  it("a single negative does NOT demote — only increments negativeStreak and resets positiveStreak", () => {
    const prev = developingLevelWithEvidence();
    const next = aggregate(
      prev,
      makeAssessment({ id: "n1", demonstratedUnderstanding: "weak", explainedInOwnWords: false, guessedOrPatternMatched: false }),
    );
    expect(next.tier).toBe("developing");
    expect(next.negativeStreak).toBe(1);
    expect(next.positiveStreak).toBe(0);
    // Evidence/strongCount untouched — the demotion threshold wasn't reached.
    expect(next.strongCount).toBe(2);
    expect(next.recentStrongEvidence).toHaveLength(1);
  });

  it("two CONSECUTIVE negatives demote one tier and reset negativeStreak/strongCount/recentStrongEvidence", () => {
    const prev = developingLevelWithEvidence();
    const negative = makeAssessment({ demonstratedUnderstanding: "weak", explainedInOwnWords: false, guessedOrPatternMatched: false });

    const afterFirst = aggregate(prev, { ...negative, id: "n1" });
    const afterSecond = aggregate(afterFirst, { ...negative, id: "n2" });

    expect(afterSecond.tier).toBe("emerging"); // stepDown(developing) === emerging
    expect(afterSecond.negativeStreak).toBe(0);
    expect(afterSecond.strongCount).toBe(0);
    expect(afterSecond.recentStrongEvidence).toEqual([]);
  });

  it("never demotes below 'emerging' — the floor (B2 §1.4)", () => {
    let level = makeLevel({ tier: "emerging" });
    const negative = makeAssessment({ demonstratedUnderstanding: "none", explainedInOwnWords: false, guessedOrPatternMatched: true });
    for (let i = 0; i < 5; i++) {
      level = aggregate(level, { ...negative, id: `n${i}` });
    }
    expect(level.tier).toBe("emerging");
  });
});

describe("aggregate — recentStrongEvidence cap (B2 §1.3 push_capped, cap 6)", () => {
  it("keeps only the 6 most recent strongPositive refs while strongCount keeps counting uncapped", () => {
    // All in the SAME session -> distinctSessions never reaches 2, so this
    // never crosses the developing->consolidated threshold and stays
    // isolated to testing the cap itself.
    let level: MasteryLevel = makeLevel({ tier: "developing", positiveStreak: 3 });
    for (let i = 1; i <= 8; i++) {
      level = aggregate(level, strongAssessment({ id: `a${i}`, sessionId: "s1", timestamp: `2026-01-01T10:${String(i).padStart(2, "0")}:00.000Z` }));
    }
    expect(level.tier).toBe("developing");
    expect(level.strongCount).toBe(8);
    expect(level.recentStrongEvidence).toHaveLength(6);
    expect(level.recentStrongEvidence.map((e) => e.assessmentId)).toEqual(["a3", "a4", "a5", "a6", "a7", "a8"]);
  });
});

describe("aggregate — consolidated -> mastered requires >=3 days since the last promotion", () => {
  it("blocks the promotion when the extra evidence arrives too soon, even with enough strongCount/sessions", () => {
    const consolidated = makeLevel({
      tier: "consolidated",
      lastPromotionAt: "2026-01-10T09:00:00.000Z",
      lastPositiveAt: "2026-01-10T09:00:00.000Z",
    });
    const tooSoon1 = aggregate(consolidated, strongAssessment({ id: "a1", sessionId: "s1", timestamp: "2026-01-10T12:00:00.000Z" }));
    expect(tooSoon1.tier).toBe("consolidated");
    const tooSoon2 = aggregate(tooSoon1, strongAssessment({ id: "a2", sessionId: "s2", timestamp: "2026-01-11T09:00:00.000Z" }));
    // strongCount=2, distinctSessions=2, but only 1 day since lastPromotionAt -> still blocked.
    expect(tooSoon2.tier).toBe("consolidated");
    expect(tooSoon2.strongCount).toBe(2);

    const onTime = aggregate(tooSoon2, strongAssessment({ id: "a3", sessionId: "s3", timestamp: "2026-01-13T09:01:00.000Z" }));
    // Now >=3 days since lastPromotionAt (2026-01-10T09:00 -> 2026-01-13T09:01).
    expect(onTime.tier).toBe("mastered");
  });
});

describe("applyDecay (B2 §1.5)", () => {
  const now = "2026-04-01T00:00:00.000Z";

  it("returns null (no change) for 'emerging' regardless of staleness", () => {
    const level = makeLevel({ tier: "emerging", lastPositiveAt: "2020-01-01T00:00:00.000Z" });
    expect(applyDecay(level, now)).toBeNull();
  });

  it("returns null when fresh (within the tier's staleness window)", () => {
    const level = makeLevel({ tier: "developing", lastPositiveAt: "2026-03-01T00:00:00.000Z" }); // 31 days < 45
    expect(applyDecay(level, now)).toBeNull();
  });

  it("developing decays to emerging after 45 days without a positive signal", () => {
    const level = makeLevel({
      tier: "developing",
      strongCount: 2,
      recentStrongEvidence: [{ assessmentId: "a1", sessionId: "s1", timestamp: "2026-01-01T00:00:00.000Z" }],
      lastPositiveAt: "2026-02-01T00:00:00.000Z", // 59 days before `now` > 45
    });
    const decayed = applyDecay(level, now);
    expect(decayed).not.toBeNull();
    expect(decayed!.tier).toBe("emerging");
    expect(decayed!.strongCount).toBe(0);
    expect(decayed!.recentStrongEvidence).toEqual([]);
  });

  it("consolidated decays to developing after 60 days", () => {
    const level = makeLevel({ tier: "consolidated", lastPositiveAt: "2026-01-01T00:00:00.000Z" }); // 90 days > 60
    expect(applyDecay(level, now)?.tier).toBe("developing");
  });

  it("mastered decays to consolidated after 90 days", () => {
    const level = makeLevel({ tier: "mastered", lastPositiveAt: "2025-12-01T00:00:00.000Z" }); // 121 days > 90
    expect(applyDecay(level, now)?.tier).toBe("consolidated");
  });

  it("a non-emerging tier with lastPositiveAt === null is treated as stale (defensive per spec's OR clause)", () => {
    const level = makeLevel({ tier: "mastered", lastPositiveAt: null });
    expect(applyDecay(level, now)?.tier).toBe("consolidated");
  });
});

describe("normalizeTopicLabel (B2 §3.2)", () => {
  it("lowercases, strips diacritics, and dashes the example from the spec/mandate", () => {
    expect(normalizeTopicLabel("Derivación de Compuestas!")).toBe("derivacion-de-compuestas");
  });

  it("handles other accented/unicode input", () => {
    expect(normalizeTopicLabel("Ecuaciones Cuadráticas")).toBe("ecuaciones-cuadraticas");
    expect(normalizeTopicLabel("¿Qué es una función?")).toBe("que-es-una-funcion");
  });

  it("null in -> null out", () => {
    expect(normalizeTopicLabel(null)).toBeNull();
  });

  it("empty or whitespace-only -> null", () => {
    expect(normalizeTopicLabel("")).toBeNull();
    expect(normalizeTopicLabel("   ")).toBeNull();
    expect(normalizeTopicLabel("!!!")).toBeNull();
  });

  it("truncates to 48 characters and re-trims dashes cut mid-truncation", () => {
    const raw = "a".repeat(50) + " b";
    const result = normalizeTopicLabel(raw);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(48);
    expect(result!.startsWith("-")).toBe(false);
    expect(result!.endsWith("-")).toBe(false);

    // Truncation lands exactly where the dashed run would produce a
    // TRAILING dash at position 48 — the post-truncate trim must strip it
    // (the "por si el truncate cortó a mitad" case, B2 §3.2).
    const rawCutOnDash = "b".repeat(47) + "  " + "tail"; // collapses to 47 b's + "-" at index 47, then "tail"
    const cutResult = normalizeTopicLabel(rawCutOnDash);
    expect(cutResult).toBe("b".repeat(47));
    expect(cutResult!.endsWith("-")).toBe(false);
  });
});

describe("foldMasteryLevel (B2 §6.2 replay primitive)", () => {
  const sequence: Assessment[] = [
    positiveAssessment({ id: "a1", sessionId: "s1", timestamp: "2026-01-01T10:00:00.000Z" }),
    positiveAssessment({ id: "a2", sessionId: "s1", timestamp: "2026-01-01T10:05:00.000Z" }),
    positiveAssessment({ id: "a3", sessionId: "s1", timestamp: "2026-01-01T10:10:00.000Z" }),
    strongAssessment({ id: "a4", sessionId: "s1", timestamp: "2026-01-01T10:15:00.000Z" }),
    strongAssessment({ id: "a5", sessionId: "s1", timestamp: "2026-01-01T10:20:00.000Z" }),
    strongAssessment({ id: "a6", sessionId: "s1", timestamp: "2026-01-01T10:25:00.000Z" }),
    strongAssessment({ id: "a7", sessionId: "s2", timestamp: "2026-01-02T09:00:00.000Z" }),
    strongAssessment({ id: "a8", sessionId: "s2", timestamp: "2026-01-02T09:05:00.000Z" }),
    strongAssessment({ id: "a9", sessionId: "s3", timestamp: "2026-01-06T09:00:00.000Z" }),
  ];

  it("returns null for an empty stream", () => {
    expect(foldMasteryLevel([])).toBeNull();
  });

  it("replays the full sequence to the same result as manual aggregate() calls", () => {
    expect(foldMasteryLevel(sequence)?.tier).toBe("mastered");
  });

  it("does not require the caller to pre-sort — sorts defensively by timestamp", () => {
    const shuffled = [...sequence].reverse();
    expect(foldMasteryLevel(shuffled)?.tier).toBe("mastered");
  });

  it("excludeAssessmentIds reproduces B2 §6.2's recomputeMasteryState: dropping the promoting evidence changes the outcome", () => {
    // a7 is the strongPositive that crossed developing -> consolidated
    // (2nd distinct session). Excluding it removes the evidence that later
    // fed the mastered promotion too — the corrected trajectory tops out
    // lower, exactly the "an Achievement's evidence was contaminated"
    // scenario B2 §6 exists for.
    const corrected = foldMasteryLevel(sequence, { excludeAssessmentIds: ["a7"] });
    expect(corrected?.tier).toBe("consolidated");
    expect(corrected?.tier).not.toBe("mastered");
  });

  it("accepts an explicit config (versioned retune, B2 §2/§3.3)", () => {
    const laxConfig = {
      ...DEFAULT_MASTERY_AGGREGATION_CONFIG,
      version: "b2-agg-2-test",
      promotion: { ...DEFAULT_MASTERY_AGGREGATION_CONFIG.promotion, developingPositiveStreak: 1 },
    };
    const level = foldMasteryLevel([positiveAssessment({ id: "a1" })], {}, laxConfig);
    expect(level?.tier).toBe("developing"); // would still be "emerging" under the default config (needs streak 3)
  });
});

describe("DEFAULT_MASTERY_AGGREGATION_CONFIG / B2_AGGREGATION_VERSION", () => {
  it("the default config is versioned as b2-agg-1", () => {
    expect(B2_AGGREGATION_VERSION).toBe("b2-agg-1");
    expect(DEFAULT_MASTERY_AGGREGATION_CONFIG.version).toBe("b2-agg-1");
  });

  it("carries every threshold from B2 §1-§3 (no loose hardcoded number elsewhere)", () => {
    expect(DEFAULT_MASTERY_AGGREGATION_CONFIG).toMatchObject({
      promotion: {
        developingPositiveStreak: 3,
        consolidatedStrongCount: 3,
        consolidatedMinDistinctSessions: 2,
        masteredStrongCount: 2,
        masteredMinDistinctSessions: 1,
        masteredMinDaysSinceLastPromotion: 3,
      },
      demotion: { negativeStreakThreshold: 2 },
      recentStrongEvidenceCap: 6,
      stalenessDays: { developing: 45, consolidated: 60, mastered: 90 },
      topicMaterializationThreshold: 3,
    });
  });
});
