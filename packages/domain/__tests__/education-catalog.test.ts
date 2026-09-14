import { describe, expect, it } from "vitest";
import {
  EducationStageSchema,
  EducationSystemSchema,
  GradeLevelSchema,
  SubjectTemplateSchema,
  type EducationSystem,
  type GradeLevel,
} from "../education-catalog";

function makeSystem(overrides: Partial<EducationSystem> = {}): EducationSystem {
  return {
    id: "sv",
    countryCode: "SV",
    nameKey: "educationSystem.sv.name",
    defaultName: "El Salvador",
    active: true,
    schemaVersion: 1,
    ...overrides,
  };
}

function makeGradeLevel(overrides: Partial<GradeLevel> = {}): GradeLevel {
  return {
    id: "sv-bachillerato-1",
    systemId: "sv",
    stageId: "sv-bachillerato",
    order: 1,
    labelKey: "gradeLevel.sv-bachillerato-1.label",
    defaultLabel: "1° año de bachillerato",
    typicalAgeMin: 15,
    typicalAgeMax: 16,
    enabled: true,
    schemaVersion: 1,
    ...overrides,
  };
}

describe("EducationSystemSchema", () => {
  it("accepts a well-formed system", () => {
    expect(EducationSystemSchema.safeParse(makeSystem()).success).toBe(true);
  });

  it("rejects a countryCode that isn't 2 letters", () => {
    expect(EducationSystemSchema.safeParse(makeSystem({ countryCode: "ESA" })).success).toBe(false);
  });
});

describe("EducationStageSchema", () => {
  it("accepts a well-formed stage", () => {
    const result = EducationStageSchema.safeParse({
      id: "sv-basica",
      systemId: "sv",
      order: 1,
      labelKey: "educationStage.sv-basica.label",
      defaultLabel: "Educación básica",
      schemaVersion: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative order", () => {
    const result = EducationStageSchema.safeParse({
      id: "sv-basica",
      systemId: "sv",
      order: -1,
      labelKey: "x",
      defaultLabel: "x",
      schemaVersion: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe("GradeLevelSchema", () => {
  it("accepts an enabled bachillerato grade with age bounds", () => {
    expect(GradeLevelSchema.safeParse(makeGradeLevel()).success).toBe(true);
  });

  it("accepts a disabled básica grade", () => {
    expect(
      GradeLevelSchema.safeParse(
        makeGradeLevel({ id: "sv-basica-1", stageId: "sv-basica", enabled: false, typicalAgeMin: 6, typicalAgeMax: 7 }),
      ).success,
    ).toBe(true);
  });

  it("accepts null age bounds (universidad)", () => {
    expect(
      GradeLevelSchema.safeParse(
        makeGradeLevel({ id: "sv-universidad-1", stageId: "sv-universidad", typicalAgeMin: null, typicalAgeMax: null }),
      ).success,
    ).toBe(true);
  });

  it("rejects a non-boolean enabled field", () => {
    expect(GradeLevelSchema.safeParse(makeGradeLevel({ enabled: "yes" as never })).success).toBe(false);
  });
});

describe("SubjectTemplateSchema", () => {
  it("accepts a well-formed template", () => {
    const result = SubjectTemplateSchema.safeParse({
      id: "sv-bachillerato-1-matematica",
      gradeLevelId: "sv-bachillerato-1",
      order: 1,
      nameKey: "subjectTemplate.matematica",
      defaultName: "Matemática",
      schemaVersion: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing defaultName", () => {
    const result = SubjectTemplateSchema.safeParse({
      id: "x",
      gradeLevelId: "sv-bachillerato-1",
      order: 1,
      nameKey: "x",
      schemaVersion: 1,
    });
    expect(result.success).toBe(false);
  });
});
