import { describe, expect, it } from "vitest";
import {
  applyAssessment,
  buildAssessorUserPrompt,
  getAssessorSystemPrompt,
  getAssessorV4SystemPrompt,
  type AssessorVerdict,
} from "../assess";
import { ASSESSOR_V4_PROMPT_VERSION, ASSESSOR_V4_PROMPT_VERSION_LOCALE } from "../mechanical-rubric";
import type { Band } from "@buxo/core/prompts";

describe("getAssessorSystemPrompt", () => {
  it("covers the anti-cheat concepts: demonstrated vs declared, own words, conservative minimal", () => {
    const prompt = getAssessorSystemPrompt();
    expect(prompt).toMatch(/DEMONSTRATED/);
    expect(prompt).toMatch(/DECLARED/i);
    expect(prompt).toMatch(/own words/i);
    expect(prompt).toMatch(/conservative/i);
    expect(prompt).toMatch(/minimal/);
    expect(prompt).toMatch(/rationale/i);
  });

  it("mentions the default subject (Calculus I) when no subject is given", () => {
    const prompt = getAssessorSystemPrompt();
    expect(prompt).toContain("Calculus I");
  });

  it("mentions a custom subject when provided", () => {
    const prompt = getAssessorSystemPrompt("Historia del Perú");
    expect(prompt).toContain("Historia del Perú");
    expect(prompt).not.toContain("Calculus I");
  });

  it("states that the assessor does not receive the study material", () => {
    const prompt = getAssessorSystemPrompt();
    expect(prompt).toMatch(/do not receive/i);
  });

  it("byte-identity guard (B2-motor-de-dominio.md §3, guarda G1 extended): omitting options — or passing topicLabeling:false — never mentions topicKey, and both are byte-identical to each other and to the no-args call the harness makes", () => {
    const noArgs = getAssessorSystemPrompt();
    const explicitSubjectOnly = getAssessorSystemPrompt("Calculus I");
    const explicitFalse = getAssessorSystemPrompt("Calculus I", { topicLabeling: false });
    const explicitUndefined = getAssessorSystemPrompt("Calculus I", {});

    expect(noArgs).not.toContain("topicKey");
    expect(explicitSubjectOnly).toBe(noArgs);
    expect(explicitFalse).toBe(noArgs);
    expect(explicitUndefined).toBe(noArgs);
  });

  it("topicLabeling:true adds a topicKey field instruction without disturbing the rest of the prompt", () => {
    const base = getAssessorSystemPrompt();
    const withTopicLabeling = getAssessorSystemPrompt(undefined, { topicLabeling: true });

    expect(withTopicLabeling).toContain("topicKey");
    expect(withTopicLabeling).toMatch(/topicKey \(string \| null\)/);
    // Identical everywhere except the field-count sentence (own test below)
    // and the appended topicKey bullet — the intro paragraphs and the 5
    // shared field bullets are untouched.
    expect(base.split("Return ")[0]).toBe(withTopicLabeling.split("Return ")[0]);
    const sharedBullets = base.slice(base.indexOf("- demonstratedUnderstanding"), base.indexOf("- rationale"));
    expect(withTopicLabeling).toContain(sharedBullets);
    expect(withTopicLabeling.endsWith("This also keeps your evaluation cheap.")).toBe(true);
  });

  it("the field-count sentence matches what's actually listed (architect review fix, F2 WQ3 parte B2-fix): 'five' on the default path, 'six' when topicLabeling adds topicKey", () => {
    const base = getAssessorSystemPrompt();
    const withTopicLabeling = getAssessorSystemPrompt(undefined, { topicLabeling: true });

    expect(base).toContain("Return five fields:");
    expect(base).not.toContain("Return six fields:");

    expect(withTopicLabeling).toContain("Return six fields:");
    expect(withTopicLabeling).not.toContain("Return five fields:");

    // Everything before the field-count sentence is untouched by the option.
    expect(base.split("Return ")[0]).toBe(withTopicLabeling.split("Return ")[0]);
  });

  describe("tutorLedRubric (PB6 Parte A — buxo-assessor-v3)", () => {
    it("byte-identity: omitting tutorLedRubric, or passing it false, never mentions the ceiling rules and is byte-identical to the no-args call, with or without topicLabeling", () => {
      const noArgs = getAssessorSystemPrompt();
      const explicitFalse = getAssessorSystemPrompt(undefined, { tutorLedRubric: false });
      const explicitUndefined = getAssessorSystemPrompt(undefined, {});
      const withTopicLabelingOnly = getAssessorSystemPrompt(undefined, { topicLabeling: true });
      const withTopicLabelingRubricFalse = getAssessorSystemPrompt(undefined, { topicLabeling: true, tutorLedRubric: false });

      expect(noArgs).not.toContain("TUTOR-LED CEILING RULES");
      expect(explicitFalse).toBe(noArgs);
      expect(explicitUndefined).toBe(noArgs);
      expect(withTopicLabelingOnly).not.toContain("TUTOR-LED CEILING RULES");
      expect(withTopicLabelingRubricFalse).toBe(withTopicLabelingOnly);
    });

    it("tutorLedRubric: true adds the 3 mechanical ceiling rules without disturbing the rest of the prompt", () => {
      const base = getAssessorSystemPrompt(undefined, { topicLabeling: true });
      const withRubric = getAssessorSystemPrompt(undefined, { topicLabeling: true, tutorLedRubric: true });

      expect(withRubric).toContain("TUTOR-LED CEILING RULES");
      // Rule 1: tutor-led ceiling on demonstratedUnderstanding/recommendedBand.
      expect(withRubric).toMatch(/capped at "developing"/);
      expect(withRubric).toMatch(/capped at "probing"/);
      // Rule 2: minimal requires all three conditions.
      expect(withRubric).toMatch(/Minimal rule/);
      expect(withRubric).toMatch(/explainedInOwnWords is true/);
      // Rule 3: mechanical verification, cites the golden-set case.
      expect(withRubric).toMatch(/Mechanical-verification rule/);
      expect(withRubric).toMatch(/ollama-004/);

      // Everything up to and including the topicKey bullet is untouched —
      // `base` (topicLabeling-only) is `intro+bullets+topicKey+closing`;
      // `withRubric` is `intro+bullets+topicKey+rubricBlock+closing`, so the
      // shared prefix up to the closing paragraph must match verbatim.
      const closingMarker = "\n\nYou do NOT receive the study material";
      expect(base.slice(0, base.indexOf(closingMarker))).toBe(
        withRubric.slice(0, withRubric.indexOf("\n\nTUTOR-LED CEILING RULES")),
      );
      // The closing paragraph is still the very end of the prompt.
      expect(withRubric.endsWith("This also keeps your evaluation cheap.")).toBe(true);
    });

    it("field count is unaffected by tutorLedRubric — it adds rules, not a new returned field", () => {
      const withTopicLabeling = getAssessorSystemPrompt(undefined, { topicLabeling: true, tutorLedRubric: true });
      expect(withTopicLabeling).toContain("Return six fields:");

      const withoutTopicLabeling = getAssessorSystemPrompt(undefined, { tutorLedRubric: true });
      expect(withoutTopicLabeling).toContain("Return five fields:");
      expect(withoutTopicLabeling).toContain("TUTOR-LED CEILING RULES");
    });
  });
});

describe("buildAssessorUserPrompt", () => {
  it("formats roles and appends the current band", () => {
    const prompt = buildAssessorUserPrompt(
      [
        { role: "assistant", content: "What rule applies here?" },
        { role: "user", content: "I think it's the power rule." },
      ],
      "probing",
    );
    expect(prompt).toContain("Tutor: What rule applies here?");
    expect(prompt).toContain("Student: I think it's the power rule.");
    expect(prompt).toContain("Current scaffolding band: probing");
  });

  it("round-trips multiline message content without losing it", () => {
    const multiline = "Step 1: derive.\nStep 2: simplify.";
    const prompt = buildAssessorUserPrompt(
      [{ role: "user", content: multiline }],
      "guiding",
    );
    expect(prompt).toContain(multiline);
  });
});

describe("applyAssessment", () => {
  const baseVerdict: AssessorVerdict = {
    demonstratedUnderstanding: "developing",
    explainedInOwnWords: true,
    guessedOrPatternMatched: false,
    recommendedBand: "probing",
    rationale: "Student justified their step.",
  };

  function verdict(overrides: Partial<AssessorVerdict>): AssessorVerdict {
    return { ...baseVerdict, ...overrides };
  }

  it("same recommended band as current: no change, rationale passed through", () => {
    const decision = applyAssessment("probing", verdict({ recommendedBand: "probing" }));
    expect(decision).toEqual({
      band: "probing",
      changed: false,
      rationale: baseVerdict.rationale,
    });
  });

  it("moving up one step (guiding -> probing) is allowed with own-words and no guessing", () => {
    const decision = applyAssessment(
      "guiding",
      verdict({ recommendedBand: "probing", explainedInOwnWords: true, guessedOrPatternMatched: false }),
    );
    expect(decision.band).toBe("probing");
    expect(decision.changed).toBe(true);
  });

  it("moving up one step (probing -> minimal) is allowed with own-words and no guessing", () => {
    const decision = applyAssessment(
      "probing",
      verdict({ recommendedBand: "minimal", explainedInOwnWords: true, guessedOrPatternMatched: false }),
    );
    expect(decision.band).toBe("minimal");
    expect(decision.changed).toBe(true);
  });

  it("moving up is blocked when explainedInOwnWords is false", () => {
    const decision = applyAssessment(
      "guiding",
      verdict({ recommendedBand: "probing", explainedInOwnWords: false, guessedOrPatternMatched: false }),
    );
    expect(decision.band).toBe("guiding");
    expect(decision.changed).toBe(false);
    expect(decision.rationale).toMatch(/own words/i);
  });

  it("moving up is blocked when guessedOrPatternMatched is true", () => {
    const decision = applyAssessment(
      "guiding",
      verdict({ recommendedBand: "probing", explainedInOwnWords: true, guessedOrPatternMatched: true }),
    );
    expect(decision.band).toBe("guiding");
    expect(decision.changed).toBe(false);
    expect(decision.rationale).toMatch(/guess|pattern/i);
  });

  it("moving up is blocked when both own-words is false and guessed is true", () => {
    const decision = applyAssessment(
      "probing",
      verdict({ recommendedBand: "minimal", explainedInOwnWords: false, guessedOrPatternMatched: true }),
    );
    expect(decision.band).toBe("probing");
    expect(decision.changed).toBe(false);
  });

  it("a 2-step recommendation up (guiding -> minimal) is clamped to 1 step, guarded by anti-cheat", () => {
    const decision = applyAssessment(
      "guiding",
      verdict({ recommendedBand: "minimal", explainedInOwnWords: true, guessedOrPatternMatched: false }),
    );
    expect(decision.band).toBe("probing");
    expect(decision.changed).toBe(true);
    expect(decision.rationale).toMatch(/clamp/i);
  });

  it("a 2-step recommendation up is blocked entirely (not even clamped) without own-words", () => {
    const decision = applyAssessment(
      "guiding",
      verdict({ recommendedBand: "minimal", explainedInOwnWords: false, guessedOrPatternMatched: false }),
    );
    expect(decision.band).toBe("guiding");
    expect(decision.changed).toBe(false);
  });

  it("a 2-step recommendation down (minimal -> guiding) is clamped to 1 step", () => {
    const decision = applyAssessment(
      "minimal",
      verdict({ recommendedBand: "guiding", explainedInOwnWords: false, guessedOrPatternMatched: true }),
    );
    expect(decision.band).toBe("probing");
    expect(decision.changed).toBe(true);
    expect(decision.rationale).toMatch(/clamp/i);
  });

  it("moving down one step (probing -> guiding) is always allowed, even if guessed", () => {
    const decision = applyAssessment(
      "probing",
      verdict({
        recommendedBand: "guiding",
        explainedInOwnWords: false,
        guessedOrPatternMatched: true,
      }),
    );
    expect(decision.band).toBe("guiding");
    expect(decision.changed).toBe(true);
  });

  it("moving down one step (minimal -> probing) is always allowed", () => {
    const decision = applyAssessment(
      "minimal",
      verdict({ recommendedBand: "probing", explainedInOwnWords: false, guessedOrPatternMatched: true }),
    );
    expect(decision.band).toBe("probing");
    expect(decision.changed).toBe(true);
  });

  it("exhaustive: every (current, recommended) pair produces a valid Band without throwing", () => {
    const bands: Band[] = ["guiding", "probing", "minimal"];
    for (const current of bands) {
      for (const recommended of bands) {
        for (const ownWords of [true, false]) {
          for (const guessed of [true, false]) {
            const decision = applyAssessment(
              current,
              verdict({
                recommendedBand: recommended,
                explainedInOwnWords: ownWords,
                guessedOrPatternMatched: guessed,
              }),
            );
            expect(bands).toContain(decision.band);
            expect(decision.rationale.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe("locale opt-in (A3b, patrón fb90dc4)", () => {
  const EN_MARKER = "preferred language is English";
  const ES_MARKER = "preferred language is Spanish";
  const RATIONALE_RULE =
    "The rationale field is free text: write it in the student's preferred language";
  const SECTION_END = "unaffected by language.";

  describe("getAssessorSystemPrompt", () => {
    it("byte-identity: omitting locale — alone or combined with the other options — keeps the render byte-identical to the no-args call", () => {
      const noArgs = getAssessorSystemPrompt();
      expect(getAssessorSystemPrompt("Calculus I", { locale: undefined })).toBe(noArgs);
      expect(getAssessorSystemPrompt("Calculus I", { topicLabeling: true, locale: undefined })).toBe(
        getAssessorSystemPrompt("Calculus I", { topicLabeling: true }),
      );
      expect(getAssessorSystemPrompt("Calculus I", { tutorLedRubric: true, locale: undefined })).toBe(
        getAssessorSystemPrompt("Calculus I", { tutorLedRubric: true }),
      );
      expect(noArgs).not.toContain(EN_MARKER);
      expect(noArgs).not.toContain(ES_MARKER);
      expect(noArgs).not.toContain(RATIONALE_RULE);
    });

    it("with locale the prompt carries the language order AND the rationale rule, exactly once, as a strict appended suffix of the default render", () => {
      const base = getAssessorSystemPrompt();
      for (const locale of ["en", "es"] as const) {
        const withLocale = getAssessorSystemPrompt("Calculus I", { locale });
        const marker = locale === "en" ? EN_MARKER : ES_MARKER;

        expect(withLocale).toContain(marker);
        expect(withLocale).toContain(RATIONALE_RULE);
        expect(withLocale.split(marker).length - 1).toBe(1);
        expect(withLocale.startsWith(base)).toBe(true);
        expect(withLocale).not.toBe(base);
        // The locale section is the LAST section of the prompt.
        expect(withLocale.endsWith(SECTION_END)).toBe(true);
      }
    });
  });

  describe("getAssessorV4SystemPrompt", () => {
    it("byte-identity: omitting options keeps the render identical to the no-options call the gate adapter makes", () => {
      const noOptions = getAssessorV4SystemPrompt();
      expect(getAssessorV4SystemPrompt("Calculus I", {})).toBe(noOptions);
      expect(getAssessorV4SystemPrompt("Calculus I", { locale: undefined })).toBe(noOptions);
      expect(noOptions).not.toContain(EN_MARKER);
      expect(noOptions).not.toContain(ES_MARKER);
      expect(noOptions).not.toContain(RATIONALE_RULE);
    });

    it("with locale the prompt carries the language order AND the rationale rule, exactly once, as a strict appended suffix of the default render", () => {
      const base = getAssessorV4SystemPrompt();
      for (const locale of ["en", "es"] as const) {
        const withLocale = getAssessorV4SystemPrompt("Calculus I", { locale });
        const marker = locale === "en" ? EN_MARKER : ES_MARKER;

        expect(withLocale).toContain(marker);
        expect(withLocale).toContain(RATIONALE_RULE);
        expect(withLocale.split(marker).length - 1).toBe(1);
        expect(withLocale.startsWith(base)).toBe(true);
        expect(withLocale).not.toBe(base);
        expect(withLocale.endsWith(SECTION_END)).toBe(true);
      }
    });
  });

  it("the v4 locale prompt version is a distinct variant of the validated default (G4 pattern)", () => {
    expect(ASSESSOR_V4_PROMPT_VERSION).toBe("buxo-assessor-v4");
    expect(ASSESSOR_V4_PROMPT_VERSION_LOCALE).toBe("buxo-assessor-v4-locale");
    expect(ASSESSOR_V4_PROMPT_VERSION_LOCALE).not.toBe(ASSESSOR_V4_PROMPT_VERSION);
  });
});
