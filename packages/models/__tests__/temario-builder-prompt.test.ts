/**
 * Tests for the temario-builder prompt builders — localización slice.
 *
 * G1 byte-identity: the default render (locale omitted or "es") MUST be
 * byte-identical to the prompt as of HEAD~ of this change — the goldens
 * below were captured from `git show HEAD:packages/models/prompts/temario-builder-prompt.ts`
 * before the locale opt-in landed. If someone changes the default render on
 * purpose, these goldens are the diff surface to review.
 *
 * The "en" variant is a separate prompt version (temario-builder-v3-en,
 * pattern from fb90dc4: PROMPT_VERSION_LOCALE) and must never be mistaken
 * for the validated default.
 */
import { describe, expect, it } from "vitest";
import {
  buildTemarioBuilderSystemPrompt,
  buildTemarioBuilderUserPrompt,
  languageName,
  PROMPT_VERSION,
  PROMPT_VERSION_EN,
  TEMARIO_BUILDER_PROMPT_VERSION_EN,
} from "../prompts/temario-builder-prompt";

// Golden renders captured byte-for-byte from HEAD before the locale opt-in.
const GOLDEN_SYSTEM_DEFAULT = `Sos un asistente académico. Tu trabajo es leer el programa de estudio proporcionado y construir un temario ordenado usando las herramientas disponibles.

Reglas estrictas:
1. Cada tema debe corresponder a una unidad, tema o concepto central que aparezca EXPLÍCITAMENTE en el programa. No inventes temas que no estén allí.
2. Usa títulos cortos y descriptivos (máximo 60 caracteres), en español.
3. Crea los temas en orden lógico de estudio, respetando el orden del programa cuando sea claro.
4. Después de crear los temas, crea hitos (parciales y/o examen_final) que marquen puntos de repaso acumulativo. El campo coversUpToOrder debe ser el índice del último tema incluido en ese hito (0-based). El primer hito cubre desde el tema 0 hasta coversUpToOrder; cada hito siguiente cubre todo lo anterior más los temas nuevos hasta su coversUpToOrder.
5. No crees hitos con coversUpToOrder mayor que el índice del último tema existente.
6. No crees temas de "introducción general", "repaso" o "evaluación" como topics; esos son hitos.
7. Si el programa no tiene suficiente detalle para dividir en temas claros, crea un temario pequeño y conservador (3-7 temas) que refleje lo que SÍ aparece.

Antes de responder con texto final, asegurate de que llamaste a createTopic para cada tema y a createMilestone para cada hito.`;

const GOLDEN_SYSTEM_SUBJECT = `Sos un asistente académico para Química General. Tu trabajo es leer el programa de estudio proporcionado y construir un temario ordenado usando las herramientas disponibles.

Reglas estrictas:
1. Cada tema debe corresponder a una unidad, tema o concepto central que aparezca EXPLÍCITAMENTE en el programa. No inventes temas que no estén allí.
2. Usa títulos cortos y descriptivos (máximo 60 caracteres), en español.
3. Crea los temas en orden lógico de estudio, respetando el orden del programa cuando sea claro.
4. Después de crear los temas, crea hitos (parciales y/o examen_final) que marquen puntos de repaso acumulativo. El campo coversUpToOrder debe ser el índice del último tema incluido en ese hito (0-based). El primer hito cubre desde el tema 0 hasta coversUpToOrder; cada hito siguiente cubre todo lo anterior más los temas nuevos hasta su coversUpToOrder.
5. No crees hitos con coversUpToOrder mayor que el índice del último tema existente.
6. No crees temas de "introducción general", "repaso" o "evaluación" como topics; esos son hitos.
7. Si el programa no tiene suficiente detalle para dividir en temas claros, crea un temario pequeño y conservador (3-7 temas) que refleje lo que SÍ aparece.

Antes de responder con texto final, asegurate de que llamaste a createTopic para cada tema y a createMilestone para cada hito.`;

const GOLDEN_USER_DEFAULT = (sourceText: string) =>
  `Programa de estudio:

---
${sourceText}
---

Construí el temario usando las herramientas createTopic y createMilestone. Recordá: solo temas que aparezcan en el programa, títulos cortos, y hitos con coversUpToOrder acumulativo.`;

const GOLDEN_USER_SUBJECT = (sourceText: string) =>
  `Programa de estudio (Química General):

---
${sourceText}
---

Construí el temario usando las herramientas createTopic y createMilestone. Recordá: solo temas que aparezcan en el programa, títulos cortos, y hitos con coversUpToOrder acumulativo.`;

const SOURCE = "Unidad 1: Enlace químico\nUnidad 2: Estequiometría";

describe("buildTemarioBuilderSystemPrompt — G1 byte-identity (default render)", () => {
  it("locale omitted renders byte-identical to HEAD", () => {
    expect(buildTemarioBuilderSystemPrompt()).toBe(GOLDEN_SYSTEM_DEFAULT);
  });

  it('explicit locale "es" renders byte-identical to HEAD (same as omitted)', () => {
    expect(buildTemarioBuilderSystemPrompt(undefined, "es")).toBe(GOLDEN_SYSTEM_DEFAULT);
    expect(buildTemarioBuilderSystemPrompt(undefined, "es")).toBe(
      buildTemarioBuilderSystemPrompt(),
    );
  });

  it("with subjectName, locale omitted renders byte-identical to HEAD", () => {
    expect(buildTemarioBuilderSystemPrompt("Química General")).toBe(GOLDEN_SYSTEM_SUBJECT);
  });
});

describe("buildTemarioBuilderUserPrompt — G1 byte-identity (default render)", () => {
  it("locale omitted renders byte-identical to HEAD", () => {
    expect(buildTemarioBuilderUserPrompt({ sourceText: SOURCE })).toBe(GOLDEN_USER_DEFAULT(SOURCE));
  });

  it('explicit locale "es" renders byte-identical to HEAD (same as omitted)', () => {
    expect(buildTemarioBuilderUserPrompt({ sourceText: SOURCE, locale: "es" })).toBe(
      GOLDEN_USER_DEFAULT(SOURCE),
    );
  });

  it("with subjectName, locale omitted renders byte-identical to HEAD", () => {
    expect(buildTemarioBuilderUserPrompt({ sourceText: SOURCE, subjectName: "Química General" })).toBe(
      GOLDEN_USER_SUBJECT(SOURCE),
    );
  });
});

describe("buildTemarioBuilderSystemPrompt — locale \"en\" (opt-in variant)", () => {
  const en = buildTemarioBuilderSystemPrompt(undefined, "en");
  const enWithSubject = buildTemarioBuilderSystemPrompt("Chemistry", "en");

  it("is written in product English, not a calque of the Spanish prompt", () => {
    expect(en).toMatch(/^You are an academic assistant\./);
    expect(en).toContain("Strict rules:");
    expect(en).not.toContain("Sos un");
    expect(en).not.toContain("español");
    expect(enWithSubject).toMatch(/^You are an academic assistant for Chemistry\./);
  });

  it("keeps the hard rules of the ES prompt (explicit topics only, 60 chars, cumulative milestones, no review/assessment topics)", () => {
    expect(en).toContain("EXPLICITLY in the syllabus");
    expect(en).toContain("60 characters max");
    expect(en).toContain("cumulative review points");
    expect(en).toContain('"general introduction", "review", or "assessment"');
    expect(en).toContain("createTopic for every topic and createMilestone for every milestone");
  });

  it("rule 2 orders titles in the student's preferred language even when the source material is in another language", () => {
    expect(en).toContain("written in English");
    expect(en).toContain("the student's preferred language");
    expect(en).toContain("even when the source material is in another language");
    // Interpolated, not hardcoded prose-only: languageName feeds the rule.
    expect(en).toContain(languageName("en"));
  });

  it("the language name is interpolated via languageName, so future locales reuse it", () => {
    expect(languageName("en")).toBe("English");
    expect(languageName("es")).toBe("español");
  });
});

describe("buildTemarioBuilderUserPrompt — locale \"en\" (opt-in variant)", () => {
  it("renders the English user prompt with the same envelope", () => {
    const en = buildTemarioBuilderUserPrompt({ sourceText: SOURCE, locale: "en" });
    expect(en).toContain("Course syllabus:");
    expect(en).toContain("---");
    expect(en).toContain(SOURCE);
    expect(en).toContain("createTopic and createMilestone tools");
    expect(en).not.toContain("Construí");
  });

  it("interpolates the subject name", () => {
    const en = buildTemarioBuilderUserPrompt({
      sourceText: SOURCE,
      subjectName: "Chemistry",
      locale: "en",
    });
    expect(en).toContain("Course syllabus (Chemistry):");
  });
});

describe("prompt versions", () => {
  it("default version is untouched and the EN variant is a separate -en version", () => {
    expect(PROMPT_VERSION).toBe("temario-builder-v3");
    expect(PROMPT_VERSION_EN).toBe("temario-builder-v3-en");
    expect(TEMARIO_BUILDER_PROMPT_VERSION_EN).toBe(PROMPT_VERSION_EN);
    expect(PROMPT_VERSION_EN).not.toBe(PROMPT_VERSION);
  });
});