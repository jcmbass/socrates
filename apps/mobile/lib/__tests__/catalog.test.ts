import { describe, expect, it } from "vitest";

import {
  enabledGradeLevelsForStage,
  gradeLevelById,
  stageOptions,
  subjectTemplatesForGradeLevel,
} from "../catalog";

describe("stageOptions", () => {
  it("returns the three stages in progression order", () => {
    expect(stageOptions().map((o) => o.stage.id)).toEqual([
      "sv-basica",
      "sv-bachillerato",
      "sv-universidad",
    ]);
  });

  it("marks básica disabled and bachillerato/universidad enabled (etapa 1)", () => {
    const byId = new Map(stageOptions().map((o) => [o.stage.id, o.enabled]));
    expect(byId.get("sv-basica")).toBe(false);
    expect(byId.get("sv-bachillerato")).toBe(true);
    expect(byId.get("sv-universidad")).toBe(true);
  });
});

describe("enabledGradeLevelsForStage", () => {
  it("returns no levels for básica (shown but not selectable)", () => {
    expect(enabledGradeLevelsForStage("sv-basica")).toEqual([]);
  });

  it("returns the 3 bachillerato years in order", () => {
    const levels = enabledGradeLevelsForStage("sv-bachillerato");
    expect(levels.map((l) => l.id)).toEqual([
      "sv-bachillerato-1",
      "sv-bachillerato-2",
      "sv-bachillerato-3",
    ]);
  });

  it("returns the 10 universidad ciclos in order", () => {
    const levels = enabledGradeLevelsForStage("sv-universidad");
    expect(levels).toHaveLength(10);
    expect(levels[0]!.defaultLabel).toBe("Ciclo 1");
    expect(levels[9]!.defaultLabel).toBe("Ciclo 10");
  });
});

describe("subjectTemplatesForGradeLevel", () => {
  it("returns templates in template order for every bachillerato level", () => {
    for (const levelId of ["sv-bachillerato-1", "sv-bachillerato-2", "sv-bachillerato-3"]) {
      const templates = subjectTemplatesForGradeLevel(levelId);
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.map((t) => t.order)).toEqual(
        [...templates.map((t) => t.order)].sort((a, b) => a - b),
      );
      expect(templates.map((t) => t.defaultName)).toContain("Matemática");
    }
  });

  it("returns NO templates for universidad ciclos (R-2: no invented careers)", () => {
    for (let ciclo = 1; ciclo <= 10; ciclo++) {
      expect(subjectTemplatesForGradeLevel(`sv-universidad-${ciclo}`)).toEqual([]);
    }
  });
});

describe("gradeLevelById", () => {
  it("resolves known levels and misses unknown ones", () => {
    expect(gradeLevelById("sv-bachillerato-2")?.defaultLabel).toBe("2° año de bachillerato");
    expect(gradeLevelById("nope")).toBeUndefined();
  });
});
