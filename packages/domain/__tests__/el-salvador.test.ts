import { describe, expect, it } from "vitest";
import {
  EL_SALVADOR_EDUCATION_SYSTEM,
  EL_SALVADOR_EDUCATION_STAGES,
  EL_SALVADOR_GRADE_LEVELS,
  EL_SALVADOR_SUBJECT_TEMPLATES,
} from "../data/el-salvador";
import {
  EducationStageSchema,
  EducationSystemSchema,
  GradeLevelSchema,
  SubjectTemplateSchema,
} from "../education-catalog";

describe("El Salvador education catalog seed data", () => {
  it("EL_SALVADOR_EDUCATION_SYSTEM validates and is 'sv', active", () => {
    expect(EducationSystemSchema.safeParse(EL_SALVADOR_EDUCATION_SYSTEM).success).toBe(true);
    expect(EL_SALVADOR_EDUCATION_SYSTEM.id).toBe("sv");
    expect(EL_SALVADOR_EDUCATION_SYSTEM.active).toBe(true);
  });

  it("every EducationStage validates and there are exactly 3 (básica, bachillerato, universidad)", () => {
    expect(EL_SALVADOR_EDUCATION_STAGES).toHaveLength(3);
    for (const stage of EL_SALVADOR_EDUCATION_STAGES) {
      expect(EducationStageSchema.safeParse(stage).success).toBe(true);
      expect(stage.systemId).toBe("sv");
    }
  });

  it("every GradeLevel validates", () => {
    for (const grade of EL_SALVADOR_GRADE_LEVELS) {
      const result = GradeLevelSchema.safeParse(grade);
      expect(result.success, `GradeLevel ${grade.id} should validate`).toBe(true);
    }
  });

  it("básica has exactly 9 grade levels, all disabled (O-13/DF-4)", () => {
    const basica = EL_SALVADOR_GRADE_LEVELS.filter((g) => g.stageId === "sv-basica");
    expect(basica).toHaveLength(9);
    expect(basica.every((g) => g.enabled === false)).toBe(true);
    // typical ages span 6..15 per B3 §2.3's seed-data note.
    expect(Math.min(...basica.map((g) => g.typicalAgeMin ?? Infinity))).toBe(6);
    expect(Math.max(...basica.map((g) => g.typicalAgeMax ?? -Infinity))).toBe(15);
  });

  it("bachillerato has exactly 3 grade levels, all enabled", () => {
    const bachillerato = EL_SALVADOR_GRADE_LEVELS.filter((g) => g.stageId === "sv-bachillerato");
    expect(bachillerato).toHaveLength(3);
    expect(bachillerato.every((g) => g.enabled === true)).toBe(true);
  });

  it("universidad has exactly 10 ciclos, all enabled, with null age bounds", () => {
    const universidad = EL_SALVADOR_GRADE_LEVELS.filter((g) => g.stageId === "sv-universidad");
    expect(universidad).toHaveLength(10);
    expect(universidad.every((g) => g.enabled === true)).toBe(true);
    expect(universidad.every((g) => g.typicalAgeMin === null && g.typicalAgeMax === null)).toBe(true);
  });

  it("every SubjectTemplate validates and is scoped to bachillerato only (producto R-2: no Career/universidad templates)", () => {
    expect(EL_SALVADOR_SUBJECT_TEMPLATES.length).toBeGreaterThan(0);
    const bachilleratoGradeIds = new Set(
      EL_SALVADOR_GRADE_LEVELS.filter((g) => g.stageId === "sv-bachillerato").map((g) => g.id),
    );
    for (const template of EL_SALVADOR_SUBJECT_TEMPLATES) {
      expect(SubjectTemplateSchema.safeParse(template).success).toBe(true);
      expect(bachilleratoGradeIds.has(template.gradeLevelId)).toBe(true);
    }
  });

  it("no SubjectTemplate references a básica or universidad GradeLevel", () => {
    const nonBachilleratoIds = new Set(
      EL_SALVADOR_GRADE_LEVELS.filter((g) => g.stageId !== "sv-bachillerato").map((g) => g.id),
    );
    const offenders = EL_SALVADOR_SUBJECT_TEMPLATES.filter((t) => nonBachilleratoIds.has(t.gradeLevelId));
    expect(offenders).toEqual([]);
  });

  it("all ids are unique across the seed dataset", () => {
    const ids = [
      EL_SALVADOR_EDUCATION_SYSTEM.id,
      ...EL_SALVADOR_EDUCATION_STAGES.map((s) => s.id),
      ...EL_SALVADOR_GRADE_LEVELS.map((g) => g.id),
      ...EL_SALVADOR_SUBJECT_TEMPLATES.map((t) => t.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
