import { describe, expect, it } from "vitest";

import { es } from "../../i18n/es";
import { en } from "../../i18n/en";
import type { Strings } from "../../i18n/es";
import { EL_SALVADOR_EDUCATION_STAGES, EL_SALVADOR_GRADE_LEVELS, EL_SALVADOR_SUBJECT_TEMPLATES } from "@buxo/domain/data/el-salvador";

import { gradeLevelIdLabel, gradeLevelLabel, stageLabel, subjectTemplateLabel } from "../catalogLabels";

/**
 * A2 — the El Salvador seed catalog renders its labels from the i18n
 * catalog by STABLE id/key (stage.id, gradeLevel.id, SubjectTemplate
 * nameKey), never by its Spanish text. Fallbacks cover unknown ids.
 */
describe("stageLabel", () => {
  it("resolves every seeded stage by id", () => {
    expect(stageLabel(EL_SALVADOR_EDUCATION_STAGES[0]!, es)).toBe("Educación básica");
    expect(stageLabel(EL_SALVADOR_EDUCATION_STAGES[1]!, es)).toBe("Bachillerato");
    expect(stageLabel(EL_SALVADOR_EDUCATION_STAGES[1]!, en)).toBe("High school");
    expect(stageLabel(EL_SALVADOR_EDUCATION_STAGES[2]!, en)).toBe("University");
  });

  it("falls back to the data's default label for an unknown stage id", () => {
    const unknown = { ...EL_SALVADOR_EDUCATION_STAGES[0]!, id: "gt-media" };
    expect(stageLabel(unknown, en)).toBe(unknown.defaultLabel);
  });
});

describe("gradeLevelLabel", () => {
  it("resolves basica, bachillerato and universidad levels by id, in both locales", () => {
    const byId = (id: string) => EL_SALVADOR_GRADE_LEVELS.find((l) => l.id === id)!;
    expect(gradeLevelLabel(byId("sv-basica-7"), es)).toBe("7º grado");
    expect(gradeLevelLabel(byId("sv-basica-7"), en)).toBe("Grade 7");
    expect(gradeLevelLabel(byId("sv-bachillerato-1"), es)).toBe("1° año de bachillerato");
    expect(gradeLevelLabel(byId("sv-bachillerato-1"), en)).toBe("Year 1 of high school");
    expect(gradeLevelLabel(byId("sv-universidad-10"), es)).toBe("Ciclo 10");
    expect(gradeLevelLabel(byId("sv-universidad-10"), en)).toBe("Year 10");
  });

  it("falls back to the data's default label for an unknown grade level id", () => {
    const unknown = { ...EL_SALVADOR_GRADE_LEVELS[0]!, id: "sv-media-1" };
    expect(gradeLevelLabel(unknown, en)).toBe(unknown.defaultLabel);
  });
});

describe("gradeLevelIdLabel", () => {
  it("resolves a known id", () => {
    expect(gradeLevelIdLabel("sv-bachillerato-2", en)).toBe("Year 2 of high school");
  });

  it("renders an unknown id as-is (server data the catalog can't label)", () => {
    expect(gradeLevelIdLabel("gt-diversificado-1", en)).toBe("gt-diversificado-1");
  });
});

describe("subjectTemplateLabel", () => {
  it("resolves every seeded nameKey, in both locales", () => {
    const labelFor = (nameKey: string, t: Strings) => {
      const template = EL_SALVADOR_SUBJECT_TEMPLATES.find((s) => s.nameKey === nameKey)!;
      return subjectTemplateLabel(template, t);
    };
    expect(labelFor("subjectTemplate.matematica", en)).toBe("Mathematics");
    expect(labelFor("subjectTemplate.fisica", en)).toBe("Physics");
    expect(labelFor("subjectTemplate.quimica", en)).toBe("Chemistry");
    expect(labelFor("subjectTemplate.lenguajeYLiteratura", en)).toBe("Language and Literature");
    // Approved by the architect (A2): the country subject gets a real translation.
    expect(labelFor("subjectTemplate.historiaDeElSalvador", en)).toBe("History of El Salvador");
    expect(labelFor("subjectTemplate.ingles", en)).toBe("English");

    expect(labelFor("subjectTemplate.matematica", es)).toBe("Matemática");
    expect(labelFor("subjectTemplate.historiaDeElSalvador", es)).toBe("Historia de El Salvador");
  });

  it("falls back to the data's default name for an unknown nameKey", () => {
    const template = { ...EL_SALVADOR_SUBJECT_TEMPLATES[0]!, nameKey: "subjectTemplate.robótica" };
    expect(subjectTemplateLabel(template, en)).toBe(template.defaultName);
  });
});