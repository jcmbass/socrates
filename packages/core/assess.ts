/**
 * Assessor — out-of-band evaluator of the STUDENT's demonstrated (not
 * declared) understanding, and the pure logic that turns its verdict into
 * the next turn's scaffolding band.
 *
 * Design context: docs/plan-harness-autonomo/00-contexto-y-arquitectura.md
 * §2-3, spec: docs/plan-harness-autonomo/02-fase-2-assessor-autotune.md.
 *
 * This module is a NEW, separate asset from the validated Socratic prompt
 * in lib/prompts.ts (guarda G1) — it does not import from or modify that
 * file's prompt-building internals, only reuses `Band`/`BANDS` types and
 * `resolveSubjectProfile` the same way lib/prompts.ts does.
 *
 * The judge (lib/prompts.ts's getJudgeSystemPrompt) measures the TUTOR on
 * one exchange. The assessor here measures the STUDENT's trajectory across
 * the whole conversation, and is the seed of the future anti-cheat score
 * (docs §2): `explainedInOwnWords`/`guessedOrPatternMatched` operationalize
 * "saying 'I get it' without ever explaining it yourself doesn't count."
 *
 * Purity contract: this module does no I/O and imports nothing from "ai" or
 * "@ai-sdk/*" — it only builds strings and makes a pure band decision. The
 * route that actually calls the model (app/api/assess/route.ts) is the thin
 * I/O layer on top, mirroring the judge's split (LECCIONES-Y-BUGS.md
 * patrón 4: "Lógica pura separada de I/O").
 */
import { BANDS, buildLanguageSection, type Band } from "@buxo/core/prompts";
import { resolveSubjectProfile } from "@buxo/core/subject";
import type { DemonstratedUnderstanding } from "./session";

/**
 * The 5 fields the model produces. Deliberately NOT `Assessment` (defined
 * in lib/session.ts) — this is the raw model verdict; the caller (fase 3)
 * composes it with `exchangeIndex`/`timestamp` into a full `Assessment`.
 */
export interface AssessorVerdict {
  demonstratedUnderstanding: DemonstratedUnderstanding;
  explainedInOwnWords: boolean;
  guessedOrPatternMatched: boolean;
  recommendedBand: Band;
  rationale: string;
}

export interface BandDecision {
  /** Effective band for the next turn. */
  band: Band;
  /** band !== currentBand */
  changed: boolean;
  /** For BandChange.rationale (fase 3); logs/founder panel only, never the student. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// getAssessorSystemPrompt
// ---------------------------------------------------------------------------

export interface AssessorSystemPromptOptions {
  /**
   * B2-motor-de-dominio.md §3 — "el assessor sigue etiquetando en la misma
   * llamada (sin costo nuevo)". Opt-in, default `false`/omitted, so the
   * harness's validated prompt (`apps/harness/app/api/assess/route.ts`,
   * which calls `getAssessorSystemPrompt(subject)` with no second argument)
   * stays byte-identical — guarda G1's byte-identity discipline extended to
   * this prompt. Only `apps/server` (B2 §3's real consumer) opts in.
   */
  topicLabeling?: boolean;
  /**
   * PRE-BETA PB6 (handoff 06-subagente-assessor-v3-y-gate-v2.md, Parte A) —
   * `buxo-assessor-v3`: hardens the topicLabeling-lineage prompt with
   * MECHANICAL rules for tutor-led understanding, diagnosed from PB5's gate
   * FAIL (28.6% laxer rate, 7/8 laxer items from the tutor-led ollama-*
   * transcripts — the assessor had the tutor-led signal in text and never
   * applied a discount for it). Opt-in and independent of `topicLabeling`
   * (though only `apps/server`, which already opts into `topicLabeling`,
   * opts into this too) so that `topicLabeling: true` alone stays exactly
   * what it was — buxo-assessor-v2, byte-identical — letting PB6 Part C run
   * both prompt versions side by side against the same real transcripts.
   * Default `false`/omitted.
   */
  tutorLedRubric?: boolean;
  /**
   * A3b — opt-in preferred language for the student. When present, appends
   * `buildAssessorLocaleSection(locale)` as the FINAL section of the prompt
   * (after the closing paragraph), covering the only free-text field this
   * prompt produces: the rationale. Default omitted: the render stays
   * byte-identical to the current prompt — same discipline as
   * `topicLabeling`/`tutorLedRubric` above (guarda G1).
   */
  locale?: "es" | "en";
}

/**
 * A3b — the assessor's language section, appended only when `options.locale`
 * is present (v3-lineage prompt) or `options.locale` on v4. It reuses the
 * tutor's `buildLanguageSection` and extends it with the assessor-specific
 * rule for its one free-text field, the rationale (never shown to the
 * student, founder's log only): it must be written in the student's
 * preferred language unless the conversation itself is in another language —
 * the language the student writes in always wins over the stored preference
 * (same precedence as AJUSTE 2 in buildLanguageSection: message > preference
 * > implicit Spanish default). The enum/boolean fields are unaffected.
 */
export function buildAssessorLocaleSection(locale: "es" | "en"): string {
  const language = locale === "en" ? "English" : "Spanish";
  return `${buildLanguageSection(locale)}
The rationale field is free text: write it in the student's preferred language (${language}), unless the conversation itself is in another language — the language the student writes in always wins over this preference. The other fields are enums or booleans and are unaffected by language.`;
}

export function getAssessorSystemPrompt(subject?: string, options?: AssessorSystemPromptOptions): string {
  const profile = resolveSubjectProfile(subject);
  // Field count must match what's actually listed below — "five" on the
  // default path, "six" when topicLabeling adds the topicKey field. A
  // mismatched count is sloppy at best and confusing to a weaker model's
  // structured-output pass at worst (flagged in architect review of B2,
  // F2 WQ3 parte B2-fix).
  const fieldCount = options?.topicLabeling ? "six" : "five";
  const base = `You are an out-of-band assessor for a Socratic ${profile.name} tutoring session. You observe the full conversation between the student and the tutor. Your job is to judge the student's DEMONSTRATED understanding — what they showed through their own reasoning — never their DECLARED understanding. A student saying "I get it now" or "ok, that makes sense" demonstrates nothing by itself.

Evaluate the student's LATEST message, in the context of the full trajectory so far (the conversation you are given typically ends with the tutor's reply to the student's latest message; the message you are assessing is the last one from the student).

Return ${fieldCount} fields:

- demonstratedUnderstanding ("none" | "weak" | "developing" | "solid"): judge only from what the student has actually produced across the trajectory, weighting the most recent turns more heavily.
- explainedInOwnWords (boolean): true ONLY if, in their latest message, the student articulated reasoning or justification in their own words. Repeating the tutor's phrasing back, giving a bare final answer with no justification, or just agreeing ("sí", "ya veo", "ok") does NOT count.
- guessedOrPatternMatched (boolean): true if the latest message looks like a guess or mechanical pattern match — an answer with no justification, mimicry of the tutor's own words, or agreement with no substance behind it.
- recommendedBand ("guiding" | "probing" | "minimal"): recommend from the scaffolding perspective. "guiding" = frequent, directive support (understanding is none/weak, or repeated failed attempts). "probing" = developing understanding, open questions. "minimal" = ONLY when the student has demonstrated solid understanding (explains in their own words, self-corrects). Be conservative about recommending "minimal": declared confidence without demonstrated reasoning is NOT enough.
- rationale (string): 1-3 sentences for the founder's log, in the language of the conversation (most likely Spanish). This is never shown to the student.`;

  const topicLabelingField = options?.topicLabeling
    ? `
- topicKey (string | null): a short label (a few words, in the language of the conversation) naming the specific topic or concept the student's latest message is actually about (e.g. "regla de la cadena", "equivalent fractions") — not the whole subject, a specific sub-topic within it. Return null if no specific topic is identifiable (e.g. the message is purely procedural/off-topic). This label does not need to match any prior label verbatim; it is normalized downstream.`
    : "";

  // PB6 Parte A — mechanical, non-adjective rules for tutor-led understanding.
  // Each rule names the literal condition to check in the transcript and the
  // exact ceiling it imposes, so a cheap model can apply it without judgment
  // calls. Grounded in PB5's laxer items (see rule 3's cited case).
  const tutorLedRubricBlock = options?.tutorLedRubric
    ? `

TUTOR-LED CEILING RULES — apply these literally, as mechanical checks, not as adjectives:

1. Tutor-led ceiling: check whether the tutor supplied the method, the test values, or the structure of the solution in an EARLIER turn (not this one). If so, and the student's latest message executes that method/values/structure — even correctly — then demonstratedUnderstanding is capped at "developing" and recommendedBand is capped at "probing" for this turn, regardless of how correct the execution is. Correctly running a method the tutor just handed you is competence, not the student's own solid understanding.
2. Minimal rule: "minimal" requires ALL three to hold for THIS turn: (a) the reasoning is the student's own, not dictated by the tutor in an earlier turn; (b) the reasoning is correct; (c) explainedInOwnWords is true. Asking for confirmation after correct, self-generated reasoning does NOT by itself disqualify "minimal". Correct work that only carries out a method the tutor already gave DOES disqualify "minimal" — apply rule 1's ceiling instead.
3. Mechanical-verification rule: if the student's latest message only substitutes values into an expression because the tutor asked them to check/verify it, treat that as evidence of correct arithmetic execution, not conceptual understanding — demonstratedUnderstanding is capped at "developing" for this turn even when every substitution is correct (this is the golden-set ollama-004 pattern: verifying three solutions by direct substitution after the tutor requested the check).`
    : "";

  const closing = `

You do NOT receive the study material — you judge the student's reasoning process, not factual accuracy (the judge and the tutor already cover that). This also keeps your evaluation cheap.`;

  const prompt = `${base}${topicLabelingField}${tutorLedRubricBlock}${closing}`;

  // A3b — the locale section is the LAST section, appended only when the
  // option is passed, so every default render stays byte-identical.
  if (options?.locale) {
    return `${prompt}\n\n${buildAssessorLocaleSection(options.locale)}`;
  }
  return prompt;
}

/**
 * Prompt del assessor-v4 (rúbrica mecánica, migración DeepInfra 2026-08-11).
 *
 * El modelo NO juzga: observa y reporta hechos verificables del transcript
 * (los campos de `MechanicalEvidence`). `deriveVerdict` en
 * `packages/core/mechanical-rubric.ts` convierte esa evidencia en
 * demonstratedUnderstanding + recommendedBand. Razón: gemma y DeepSeek son
 * buenos observando y malos siendo severos (calibración 60.7% / 25.0% vs
 * 20%) — la severidad sale del modelo y se vuelve código testeable.
 *
 * Los campos se describen como CHECKS mecánicos (qué verificar en el
 * transcript), no como adjetivos — misma disciplina que las reglas 1-3 de v3.
 */
export interface AssessorV4SystemPromptOptions {
  /**
   * A3b — opt-in preferred language for the student, same contract as
   * `AssessorSystemPromptOptions.locale`: when present, appends
   * `buildAssessorLocaleSection(locale)` as the final section (the rationale
   * is v4's only free-text field too). Default omitted: byte-identical
   * render — the gate adapter (`apps/gate-runner/candidate-adapter-v4.ts`)
   * calls this with no options and must not change.
   */
  locale?: "es" | "en";
}

export function getAssessorV4SystemPrompt(subject?: string, options?: AssessorV4SystemPromptOptions): string {
  const profile = resolveSubjectProfile(subject);
  const base = `You are an out-of-band OBSERVER for a Socratic ${profile.name} tutoring session. You do NOT judge or grade. You report VERIFIABLE FACTS about the student's LATEST message (the last student message in the conversation) and about what the tutor did EARLIER. A downstream deterministic function computes the grade from your facts — your job is only to observe accurately.

Conversation format: the transcript you are given alternates Student and Tutor messages, ending with the tutor's reply to the student's latest message. The message you observe is the last one FROM THE STUDENT.

Report these facts (all are boolean unless noted):

- studentGaveReasoning: the student's latest message contains an explicit reason, explanation, or justification (not just a result, an agreement, or a question).
- reasoningInOwnWords: IF the student gave reasoning, it is in their OWN words — not a repetition of the tutor's phrasing. Repeating the tutor's words back verbatim or nearly verbatim is NOT own words.
- bareResultOnly: the latest message is a bare result/answer with NO justification (true even if the answer is correct).
- agreementOnly: the latest message only agrees ("sí", "ya veo", "ok") with nothing substantive behind it.
- questionOnly: the latest message only asks a question, contributing no content of its own.
- tutorSuppliedMethodEarlier: in an EARLIER turn (NOT the latest), the tutor supplied the method, the test values, or the structure of the solution.
- studentExecutesTutorMethod: the latest message executes that handed-over method/values/structure. Only meaningful if tutorSuppliedMethodEarlier is true (else false).
- mechanicalVerificationOnly: the latest message only substitutes values into an expression because the tutor asked the student to check/verify it.
- selfCorrected: the student self-corrected in the latest message or in a recent turn.
- reasoningCoherent (boolean or null): IF the student gave reasoning, is it internally coherent/correct as a reasoning process? (Judge the reasoning process, NOT the factual accuracy of the answer — you receive no study material.) null if there is no reasoning to judge.
- rationale (string): 1-3 sentences for the founder's log, in the language of the conversation (most likely Spanish). Summarize the observable evidence (e.g. "dio la respuesta pelada; el tutor había dado el método antes"). Never shown to the student.

Return ONLY these fields with the exact keys and types above.`;

  // A3b — same opt-in discipline as the v3-lineage prompt: the locale section
  // is appended only when the option is passed, as the final section.
  if (options?.locale) {
    return `${base}\n\n${buildAssessorLocaleSection(options.locale)}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// buildAssessorUserPrompt
// ---------------------------------------------------------------------------

export interface AssessorMessage {
  role: "user" | "assistant";
  content: string;
}

const ROLE_LABEL: Record<AssessorMessage["role"], string> = {
  user: "Student",
  assistant: "Tutor",
};

export function buildAssessorUserPrompt(
  messages: AssessorMessage[],
  currentBand: Band,
): string {
  const transcript = messages
    .map((m) => `${ROLE_LABEL[m.role]}: ${m.content}`)
    .join("\n\n");
  return `${transcript}\n\nCurrent scaffolding band: ${currentBand}. Assess the student's latest message.`;
}

// ---------------------------------------------------------------------------
// applyAssessment — pure band control logic
// ---------------------------------------------------------------------------

/** Scaffolding order, decreasing: guiding (0) -> probing (1) -> minimal (2). */
const BAND_ORDER: Record<Band, number> = {
  guiding: 0,
  probing: 1,
  minimal: 2,
};

function clampStep(fromIndex: number, toIndex: number): number {
  if (toIndex > fromIndex) return Math.min(fromIndex + 1, toIndex);
  if (toIndex < fromIndex) return Math.max(fromIndex - 1, toIndex);
  return fromIndex;
}

function bandAtIndex(index: number): Band {
  return BANDS[index];
}

/**
 * Turns an assessor verdict into the next turn's band. Rules, in order
 * (spec §"applyAssessment"):
 *
 * 1. One-step clamp: the band moves at most one step per exchange toward
 *    recommendedBand (avoids a whiplash guiding -> minimal off one good
 *    answer).
 * 2. Anti-cheat guard (the central rule): a move toward LESS scaffolding
 *    (higher index) is only allowed if explainedInOwnWords === true AND
 *    guessedOrPatternMatched === false. Otherwise the band holds where it
 *    is and the rationale says so.
 * 3. Moving toward MORE scaffolding (lower index) is never blocked — we
 *    never withhold help from a student who needs it, even if they also
 *    guessed.
 * 4. recommendedBand === currentBand -> changed: false, verdict's rationale
 *    passed through unchanged.
 */
export function applyAssessment(currentBand: Band, verdict: AssessorVerdict): BandDecision {
  const currentIndex = BAND_ORDER[currentBand];
  const recommendedIndex = BAND_ORDER[verdict.recommendedBand];

  if (recommendedIndex === currentIndex) {
    return { band: currentBand, changed: false, rationale: verdict.rationale };
  }

  const movingTowardLessScaffolding = recommendedIndex > currentIndex;

  if (movingTowardLessScaffolding) {
    const allowed = verdict.explainedInOwnWords && !verdict.guessedOrPatternMatched;
    if (!allowed) {
      const reason = !verdict.explainedInOwnWords
        ? "student did not explain in own words"
        : "student's answer looked guessed or pattern-matched";
      return {
        band: currentBand,
        changed: false,
        rationale: `${verdict.rationale} (recommended ${verdict.recommendedBand} but ${reason} — holding ${currentBand})`,
      };
    }
  }

  const clampedIndex = clampStep(currentIndex, recommendedIndex);
  const nextBand = bandAtIndex(clampedIndex);
  const changed = nextBand !== currentBand;
  const wasClamped = clampedIndex !== recommendedIndex;
  const rationale = wasClamped
    ? `${verdict.rationale} (clamped one step: recommended ${verdict.recommendedBand}, moved to ${nextBand})`
    : verdict.rationale;

  return { band: nextBand, changed, rationale };
}
