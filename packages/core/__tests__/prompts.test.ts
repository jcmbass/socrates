import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BANDS,
  PERSONA,
  NEVER_DIRECT_ANSWER,
  NEVER_DIRECT_ANSWER_CORE,
  SESSION_OPENING_USER_INSTRUCTION,
  CITE_OR_UNCERTAIN,
  ESCAPE_HATCH,
  OPERATING_RULES,
  PROMPT_VERSION,
  PROMPT_VERSION_HARDENED,
  PROMPT_VERSION_LOCALE,
  buildHardenedRules,
  buildLanguageSection,
  getSystemPrompt,
  getJudgeSystemPrompt,
} from "../prompts";

const FIXTURES_DIR = join(__dirname, "__fixtures__");
function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("getSystemPrompt — all bands derive from one base", () => {
  it("includes the exact same persona substring in every band", () => {
    for (const band of BANDS) {
      expect(getSystemPrompt(band)).toContain(PERSONA);
    }
  });

  it("includes the escape-hatch instruction in every band", () => {
    for (const band of BANDS) {
      expect(getSystemPrompt(band)).toContain(ESCAPE_HATCH);
    }
  });

  it("includes the operating-rules instruction in every band", () => {
    for (const band of BANDS) {
      expect(getSystemPrompt(band)).toContain(OPERATING_RULES);
    }
  });

  it("includes the cite-or-uncertain instruction in every band", () => {
    for (const band of BANDS) {
      expect(getSystemPrompt(band)).toContain(CITE_OR_UNCERTAIN);
    }
  });

  it("includes the never-direct-answer instruction in every band", () => {
    for (const band of BANDS) {
      expect(getSystemPrompt(band)).toContain(NEVER_DIRECT_ANSWER);
    }
  });

  it("keeps NEVER_DIRECT_ANSWER_CORE in the session-opening instruction without the last-answer clause", () => {
    expect(NEVER_DIRECT_ANSWER).toContain(NEVER_DIRECT_ANSWER_CORE);
    expect(SESSION_OPENING_USER_INSTRUCTION).toContain(NEVER_DIRECT_ANSWER_CORE);
    expect(SESSION_OPENING_USER_INSTRUCTION).not.toContain(
      "Always respond with a question that builds directly on the student's last answer.",
    );
    expect(SESSION_OPENING_USER_INSTRUCTION).toMatch(/has not spoken yet/i);
    expect(SESSION_OPENING_USER_INSTRUCTION).toMatch(/do not invent or quote a student reply/i);
    expect(SESSION_OPENING_USER_INSTRUCTION).toMatch(/under 65 words/i);
  });

  it("produces a different prompt per band (scaffolding params vary)", () => {
    const prompts = BANDS.map((band) => getSystemPrompt(band));
    const unique = new Set(prompts);
    expect(unique.size).toBe(BANDS.length);
  });

  it("injects study material into the prompt when provided", () => {
    const withMaterial = getSystemPrompt("guiding", "d/dx x^2 = 2x");
    expect(withMaterial).toContain("d/dx x^2 = 2x");
    const withoutMaterial = getSystemPrompt("guiding");
    expect(withoutMaterial).not.toContain("Study material provided");
  });
});

describe("G1 — default render is byte-identical to buxo-socratic-v2 (docs/plan-tutor-general)", () => {
  // Fixtures were captured from the intact v2 code before the subject-
  // parametrization refactor (lib/__tests__/__fixtures__/). If any of these
  // fail, the refactor changed the default's bytes — the fix is in the
  // template code, never in the fixtures.
  it.each(BANDS)("getSystemPrompt(%s) matches the v2 fixture", (band) => {
    const fixture = readFixture(`system-prompt-v2-${band}.txt`);
    expect(getSystemPrompt(band)).toBe(fixture);
  });

  it("getJudgeSystemPrompt() matches the v2 judge fixture", () => {
    const fixture = readFixture("judge-prompt-v2.txt");
    expect(getJudgeSystemPrompt()).toBe(fixture);
  });
});

describe("subject parametrization", () => {
  it("substitutes the subject name into the persona and drops Calculus I", () => {
    const prompt = getSystemPrompt("guiding", undefined, "Historia del Perú");
    expect(prompt).toContain("Socratic tutor for Historia del Perú");
    expect(prompt).not.toContain("Calculus I");
  });

  it("treats a Calculus I alias as the default subject", () => {
    expect(getSystemPrompt("guiding", undefined, "cálculo I")).toBe(
      getSystemPrompt("guiding"),
    );
  });

  it("substitutes the subject name into the judge prompt and drops Calculus I", () => {
    const prompt = getJudgeSystemPrompt("Historia del Perú");
    expect(prompt).toContain("a Socratic Historia del Perú tutoring transcript");
    expect(prompt).toContain("factually and conceptually correct and substantively complete");
    expect(prompt).not.toContain("Calculus I");
    expect(prompt).not.toContain("mathematically correct");
  });

  it("treats a Calculus I alias as the default subject for the judge prompt", () => {
    expect(getJudgeSystemPrompt("Calculus")).toBe(getJudgeSystemPrompt());
  });
});

describe("G4 — hardened opt-in (buxo-socratic-v4, F3)", () => {
  it("byte-identity: omitting options, or passing { hardened: false }, never mentions the hardened rules and is byte-identical to the no-args call", () => {
    const noArgs = getSystemPrompt("guiding");
    const explicitFalse = getSystemPrompt("guiding", undefined, undefined, { hardened: false });
    const explicitUndefined = getSystemPrompt("guiding", undefined, undefined, {});

    expect(noArgs).not.toContain("HARDENED PRESSURE PROTOCOL");
    expect(explicitFalse).toBe(noArgs);
    expect(explicitUndefined).toBe(noArgs);
  });

  it("byte-identity: all three bands with { hardened: false } match the v2 fixtures", () => {
    for (const band of BANDS) {
      const fixture = readFixture(`system-prompt-v2-${band}.txt`);
      expect(getSystemPrompt(band, undefined, undefined, { hardened: false })).toBe(fixture);
    }
  });

  it("hardened: true adds the pressure protocol block without disturbing the rest of the prompt", () => {
    const base = getSystemPrompt("guiding");
    const hardened = getSystemPrompt("guiding", undefined, undefined, { hardened: true });

    expect(hardened).toContain("HARDENED PRESSURE PROTOCOL");
    expect(hardened).toContain("ABSOLUTE PROHIBITIONS");
    expect(hardened).toContain("PRESSURE PROTOCOL");
    expect(hardened).toContain("FINAL SELF-CHECK");

    // Everything before the hardened block is untouched
    const closingMarker = "\n\nStudy material provided";
    const basePrefix = base.includes(closingMarker)
      ? base.slice(0, base.indexOf(closingMarker))
      : base;
    expect(hardened.startsWith(basePrefix)).toBe(true);
  });

  it("hardened: true works in every band", () => {
    for (const band of BANDS) {
      const prompt = getSystemPrompt(band, undefined, undefined, { hardened: true });
      expect(prompt).toContain("HARDENED PRESSURE PROTOCOL");
      expect(prompt).toContain(PERSONA);
      expect(prompt).toContain(ESCAPE_HATCH);
      expect(prompt).toContain(OPERATING_RULES);
    }
  });

  it("hardened: true with study material includes both the hardened block and the material", () => {
    const prompt = getSystemPrompt("guiding", "d/dx x^2 = 2x", undefined, { hardened: true });
    expect(prompt).toContain("HARDENED PRESSURE PROTOCOL");
    expect(prompt).toContain("d/dx x^2 = 2x");
    // Hardened block comes before material
    const hardenedIndex = prompt.indexOf("HARDENED PRESSURE PROTOCOL");
    const materialIndex = prompt.indexOf("d/dx x^2 = 2x");
    expect(hardenedIndex).toBeLessThan(materialIndex);
  });

  it("hardened: true with a custom subject substitutes the subject name", () => {
    const prompt = getSystemPrompt("guiding", undefined, "Historia del Perú", { hardened: true });
    expect(prompt).toContain("Socratic tutor for Historia del Perú");
    expect(prompt).toContain("HARDENED PRESSURE PROTOCOL");
    expect(prompt).not.toContain("Calculus I");
  });

  it("PROMPT_VERSION_HARDENED is buxo-socratic-v4", () => {
    expect(PROMPT_VERSION_HARDENED).toBe("buxo-socratic-v4");
  });

  it("PROMPT_VERSION_LOCALE is a distinct version from the validated default and the hardened one", () => {
    expect(PROMPT_VERSION_LOCALE).toBe("buxo-socratic-v3-locale");
    expect(PROMPT_VERSION_LOCALE).not.toBe(PROMPT_VERSION);
    expect(PROMPT_VERSION_LOCALE).not.toBe(PROMPT_VERSION_HARDENED);
  });

  it("buildHardenedRules is a non-empty string containing all three sections", () => {
    const rules = buildHardenedRules();
    expect(rules.length).toBeGreaterThan(100);
    expect(rules).toContain("ABSOLUTE PROHIBITIONS");
    expect(rules).toContain("PRESSURE PROTOCOL");
    expect(rules).toContain("FINAL SELF-CHECK");
  });
});

describe("A3b — locale opt-in (preferred language)", () => {
  it("byte-identity: omitting options — or passing {} or { locale: undefined } — never mentions the language section and matches the G1 v2 fixtures", () => {
    const noArgs = getSystemPrompt("guiding");
    expect(getSystemPrompt("guiding", undefined, undefined, {})).toBe(noArgs);
    expect(getSystemPrompt("guiding", undefined, undefined, { locale: undefined })).toBe(noArgs);
    expect(noArgs).not.toContain("preferred language is");
    for (const band of BANDS) {
      const fixture = readFixture(`system-prompt-v2-${band}.txt`);
      expect(getSystemPrompt(band)).toBe(fixture);
    }
  });

  it("locale 'en': the preferred language is English and the respond-in-English order carries the escape to the message's own language", () => {
    const prompt = getSystemPrompt("guiding", undefined, undefined, { locale: "en" });
    expect(prompt).toContain("the student's preferred language is English");
    expect(prompt).toContain("Respond in English by default; if the student writes in another language, answer in that language.");
  });

  it("locale 'es': the preferred language is Spanish", () => {
    const prompt = getSystemPrompt("probing", undefined, undefined, { locale: "es" });
    expect(prompt).toContain("the student's preferred language is Spanish");
    expect(prompt).not.toContain("preferred language is English");
  });

  it("the language section appears exactly once and is the LAST section of the prompt", () => {
    const section = buildLanguageSection("en");
    for (const band of BANDS) {
      const prompt = getSystemPrompt(band, "d/dx x^2 = 2x", undefined, { locale: "en", hardened: true });
      expect(prompt.split(section).length - 1).toBe(1);
      expect(prompt.endsWith(section)).toBe(true);
      // It survives the empty-section filter, so it is preceded by the join separator.
      expect(prompt.endsWith(`\n\n${section}`)).toBe(true);
    }
  });

  it("with a locale the render differs from the default, and the default prefix stays intact", () => {
    const base = getSystemPrompt("guiding");
    const localized = getSystemPrompt("guiding", undefined, undefined, { locale: "en" });
    expect(localized).not.toBe(base);
    expect(localized.startsWith(base)).toBe(true);
  });
});
