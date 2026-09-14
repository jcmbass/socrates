import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBJECT_PROFILE,
  resolveSubjectProfile,
  sanitizeSubject,
} from "../subject";

describe("sanitizeSubject", () => {
  it("collapses internal whitespace (including newlines) to a single space", () => {
    expect(sanitizeSubject("Historia   del\nPerú\t colonial")).toBe(
      "Historia del Perú colonial",
    );
  });

  it("strips control characters", () => {
    expect(sanitizeSubject("Historia\x00 del\x1BPerú\x7F")).toBe("Historia del Perú");
  });

  it("trims leading/trailing whitespace", () => {
    expect(sanitizeSubject("   Historia del Perú   ")).toBe("Historia del Perú");
  });

  it("truncates to 60 characters", () => {
    const long = "A".repeat(100);
    const result = sanitizeSubject(long);
    expect(result.length).toBe(60);
    expect(result).toBe("A".repeat(60));
  });

  it("preserves unicode characters (accents, ñ)", () => {
    expect(sanitizeSubject("Química Orgánica: Reacciones y Mecanismos")).toBe(
      "Química Orgánica: Reacciones y Mecanismos",
    );
  });

  it("returns an empty string for whitespace-only or control-only input", () => {
    expect(sanitizeSubject("   \n\t  ")).toBe("");
    expect(sanitizeSubject("\x00\x1F\x7F")).toBe("");
  });
});

describe("resolveSubjectProfile", () => {
  it("returns DEFAULT_SUBJECT_PROFILE when subject is undefined", () => {
    expect(resolveSubjectProfile(undefined)).toEqual(DEFAULT_SUBJECT_PROFILE);
  });

  it("returns DEFAULT_SUBJECT_PROFILE when subject is empty after sanitizing", () => {
    expect(resolveSubjectProfile("   ")).toEqual(DEFAULT_SUBJECT_PROFILE);
    expect(resolveSubjectProfile("\x00\x1F")).toEqual(DEFAULT_SUBJECT_PROFILE);
  });

  it("returns DEFAULT_SUBJECT_PROFILE for Spanish calculus aliases", () => {
    expect(resolveSubjectProfile("cálculo I")).toEqual(DEFAULT_SUBJECT_PROFILE);
    expect(resolveSubjectProfile("calculo diferencial")).toEqual(DEFAULT_SUBJECT_PROFILE);
    expect(resolveSubjectProfile("Cálculo")).toEqual(DEFAULT_SUBJECT_PROFILE);
  });

  it("returns DEFAULT_SUBJECT_PROFILE for English calculus aliases", () => {
    expect(resolveSubjectProfile("calculus")).toEqual(DEFAULT_SUBJECT_PROFILE);
    expect(resolveSubjectProfile("Calculus II")).toEqual(DEFAULT_SUBJECT_PROFILE);
  });

  it("returns a generic profile carrying the sanitized name for any other subject", () => {
    const profile = resolveSubjectProfile("Historia del Perú");
    expect(profile).toEqual({
      name: "Historia del Perú",
      domainNoun: "subject matter",
      factExamples: "a named result, a definition, a primary source",
      judgeCorrectness: "factually and conceptually correct",
    });
  });

  it("sanitizes the subject before building the generic profile", () => {
    const profile = resolveSubjectProfile("  Historia\ndel   Perú  ");
    expect(profile.name).toBe("Historia del Perú");
  });

  it("does not misclassify a subject that merely contains 'calculus' mid-string as an alias", () => {
    const profile = resolveSubjectProfile("Applications of Calculus in Economics");
    expect(profile.name).toBe("Applications of Calculus in Economics");
    expect(profile).not.toEqual(DEFAULT_SUBJECT_PROFILE);
  });
});
