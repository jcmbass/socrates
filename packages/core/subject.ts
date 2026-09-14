/**
 * Subject profile — the "materia" parameter (plan: docs/plan-tutor-general/).
 *
 * buxo's Socratic scaffolding engine (never-direct-answer, cite-or-uncertain,
 * escape hatch, operating rules, Fade bands) is ~95% agnostic to subject
 * matter. The only Calculus-I-specific text lives in a handful of template
 * points in lib/prompts.ts. This module makes the subject a runtime
 * parameter, the same way band already is.
 *
 * Rule of gold (G1, see docs/plan-tutor-general/00-contexto-y-reglas.md):
 * DEFAULT_SUBJECT_PROFILE's values are exactly the strings that reproduce
 * the validated buxo-socratic-v2 prompt byte-for-byte. Do not paraphrase
 * them — a fixture test in lib/__tests__/prompts.test.ts enforces this.
 */

export interface SubjectProfile {
  /** Name shown to the model: "Calculus I" | the student's free-text subject. */
  name: string;
  /** Replaces "mathematics" in OPERATING_RULES. */
  domainNoun: string;
  /** Replaces the citation examples in CITE_OR_UNCERTAIN. */
  factExamples: string;
  /** Replaces "mathematically correct" in the judge prompt. */
  judgeCorrectness: string;
}

/**
 * The subject profile that reproduces buxo-socratic-v2 byte-for-byte. Used
 * whenever no subject is given, or the student's subject is a Calculus I
 * alias — the validated default path must never move under either case.
 */
export const DEFAULT_SUBJECT_PROFILE: SubjectProfile = {
  name: "Calculus I",
  domainNoun: "mathematics",
  factExamples: "a theorem name, a definition, a standard result",
  judgeCorrectness: "mathematically correct",
};

/** Generic, subject-agnostic profile for any non-calculus subject. */
const GENERIC_SUBJECT_PROFILE: Omit<SubjectProfile, "name"> = {
  domainNoun: "subject matter",
  factExamples: "a named result, a definition, a primary source",
  judgeCorrectness: "factually and conceptually correct",
};

/** Calculus I aliases (Spanish and English) that must resolve to the default profile. */
const CALCULUS_ALIAS_PATTERNS = [/^c[áa]lculo\b/i, /^calculus\b/i];

/**
 * Sanitizes free-text subject input before it enters the system prompt
 * (R6 — this text is a prompt-injection surface). Pure: collapses internal
 * whitespace/newlines to single spaces, strips control characters, trims,
 * and caps length at 60 chars. Does not otherwise interpret the text.
 */
export function sanitizeSubject(raw: string): string {
  // Deliberately targets control chars (incl. newlines) — R6 sanitization.
  const noControlChars = raw.replace(/[\x00-\x1F\x7F]/g, " ");
  const collapsedWhitespace = noControlChars.replace(/\s+/g, " ").trim();
  return collapsedWhitespace.slice(0, 60);
}

/**
 * Resolves free-text subject input into a full SubjectProfile. Pure.
 *
 * - undefined, empty after sanitizing, or a Calculus I alias → the frozen
 *   default profile (byte-identical to v2).
 * - Anything else → a generic profile carrying the sanitized name.
 */
export function resolveSubjectProfile(subject?: string): SubjectProfile {
  if (subject === undefined) return DEFAULT_SUBJECT_PROFILE;

  const sanitized = sanitizeSubject(subject);
  if (sanitized.length === 0) return DEFAULT_SUBJECT_PROFILE;

  const isCalculusAlias = CALCULUS_ALIAS_PATTERNS.some((pattern) => pattern.test(sanitized));
  if (isCalculusAlias) return DEFAULT_SUBJECT_PROFILE;

  return { name: sanitized, ...GENERIC_SUBJECT_PROFILE };
}
