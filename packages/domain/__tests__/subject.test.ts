import { describe, expect, it } from "vitest";
import { SubjectSchema, type Subject } from "../subject";

function makeSubject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: "subject-1",
    userId: "user-1",
    courseId: "course-1",
    name: "Cálculo I",
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
    archivedAt: null,
    seedCatalogKey: null,
    seedLang: null,
    schemaVersion: 1,
    ...overrides,
  };
}

describe("SubjectSchema", () => {
  it("accepts a well-formed Subject", () => {
    expect(SubjectSchema.safeParse(makeSubject()).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(SubjectSchema.safeParse(makeSubject({ name: "" })).success).toBe(false);
  });

  it("rejects a name over the 60-char cap (B3 §2.5, prompt-injection surface R6)", () => {
    expect(SubjectSchema.safeParse(makeSubject({ name: "x".repeat(61) })).success).toBe(false);
  });

  it("accepts a name exactly at the 60-char cap", () => {
    expect(SubjectSchema.safeParse(makeSubject({ name: "x".repeat(60) })).success).toBe(true);
  });
});
