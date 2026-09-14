/**
 * Assessor call — C-backend §1.1/§1.3, ported from
 * `apps/harness/app/api/assess/route.ts` onto `StructuredAdapter`
 * (@buxo/models). The degrade-to-null contract is preserved EXACTLY: a
 * failed/exhausted chain returns `null`, never throws — the caller
 * (routes/sessions.ts) treats a null verdict as "this turn doesn't move the
 * band", same as the alfa.
 *
 * Cost for §2.5's quota accounting ("sus llamadas SÍ cuentan hacia el cap de
 * USD del usuario") comes straight off `StructuredCallResult.costUsd`
 * (@buxo/models/execution/structured.ts, TODOS.md "deuda F1/WP5" paid off) —
 * no per-call `InMemoryTelemetrySink` workaround needed anymore. A
 * `NoopTelemetrySink` still gets built per call via the `createStructuredAdapter`
 * factory (adapters.ts's indirection is what lets `BUXO_FAKE_MODELS` swap in
 * the fake adapter — kept as-is, only the cost-recovery path changes).
 *
 * F2 WQ3 parte B2 (B2-motor-de-dominio.md §3): `apps/server` is the ONE
 * caller that opts into `getAssessorSystemPrompt`'s `topicLabeling` field —
 * the harness's own call (`apps/harness/app/api/assess/route.ts`) is
 * untouched and stays byte-identical (guarda G1, see
 * `packages/core/__tests__/assess.test.ts`'s byte-identity guard). Bumping
 * to `ASSESSOR_PROMPT_VERSION = "buxo-assessor-v2"` here (not
 * `"buxo-assessor-v1"`, the harness's own unversioned prompt) marks this as
 * a DIFFERENT, apps/server-only prompt variant from that point on — TODOS.md
 * has the note that v2 needs a real gate (WQ5/beta) before it drives
 * anything but shadow aggregation against fakes (F2 scope).
 *
 * PRE-BETA PB6 (handoff 06-subagente-assessor-v3-y-gate-v2.md): v2's real
 * gate (PB5) came back FAIL — 28.6% laxer rate, concentrated in tutor-led
 * transcripts (`ollama-*`) where the assessor inflated developing→solid
 * without discounting for the tutor having supplied the method. Bumped to
 * `ASSESSOR_PROMPT_VERSION = "buxo-assessor-v3"`, which opts into
 * `getAssessorSystemPrompt`'s new `tutorLedRubric` option (PB6 Parte A,
 * `packages/core/assess.ts`) alongside the existing `topicLabeling` opt-in —
 * same byte-identity discipline: the harness's own call is untouched.
 */
import { z } from "zod";
import { BANDS } from "@buxo/core/prompts";
import { buildAssessorUserPrompt, getAssessorSystemPrompt, type AssessorMessage, type AssessorVerdict } from "@buxo/core/assess";
import { NoopTelemetrySink } from "@buxo/models/telemetry";
import type { ModelRef } from "@buxo/models/task";
import type { ModelDeps } from "./adapters";

/**
 * F2 WQ3 parte B2 — bumped from the harness's implicit "buxo-assessor-v1"
 * because the topicLabeling-augmented prompt is a materially different
 * assessor variant (O-9 discipline). PB6 — bumped again to "buxo-assessor-v3"
 * for the tutor-led ceiling rules (see module doc above); v2 stays available
 * in `@buxo/gate-runner`'s real-transcript candidate adapter for PB6 Part C's
 * side-by-side comparison against v3.
 */
export const ASSESSOR_PROMPT_VERSION = "buxo-assessor-v3";

/**
 * Slice localización (A3b s4/AJUSTE 4): variante -locale del lineage v3 de
 * ESTE archivo. La const de v4 vive en `@buxo/core/mechanical-rubric`
 * (`ASSESSOR_V4_PROMPT_VERSION_LOCALE`); la de v3 vive acá porque el prompt
 * v3 es propiedad de apps/server (see ASSESSOR_PROMPT_VERSION above). Patrón
 * G4 de fb90dc4: una corrida con la sección de idioma nunca debe poder
 * confundirse con una del default validado.
 */
export const ASSESSOR_PROMPT_VERSION_LOCALE = "buxo-assessor-v3-locale";

export const assessorSchema = z.object({
  demonstratedUnderstanding: z.enum(["none", "weak", "developing", "solid"]),
  explainedInOwnWords: z.boolean(),
  guessedOrPatternMatched: z.boolean(),
  recommendedBand: z.enum(BANDS),
  rationale: z.string(),
  /** B2 §3 — RAW label straight off the model, un-normalized. `recordAssessment` (repositories/assessments.ts) normalizes it at the point the Assessment is constructed. */
  topicKey: z.string().nullable(),
});

export interface RunAssessorInput {
  messages: AssessorMessage[];
  currentBand: (typeof BANDS)[number];
  subject?: string;
  /**
   * Diseño de dos modelos (2026-08-11): "assessor" (default) = cadena de
   * banda (DeepSeek, cada turno); "mastery-assessor" = cadena de mastery
   * (Qwen, muestreado). Mismo prompt y schema, distinta cadena.
   */
  task?: "assessor" | "mastery-assessor";
  /**
   * A3b/AJUSTE 4 (slice localización): opt-in preferred language of the
   * student. Only "en" may be passed — "es" is the default render and MUST
   * arrive here as `undefined` (passing "es" would append the Spanish
   * language section to a prompt whose installed base never chose it,
   * breaking byte-identity). When present, appends
   * `buildAssessorLocaleSection(locale)` as the last section (only free
   * text affected: the rationale) and the persisted promptVersion becomes
   * `ASSESSOR_PROMPT_VERSION_LOCALE` (patrón G4).
   */
  locale?: "es" | "en";
}

export interface AssessorOutcome {
  verdict: AssessorVerdict | null;
  /** RAW (un-normalized) topic label — `null` when the verdict is `null` OR the model returned no topic. */
  topicKeyRaw: string | null;
  servedBy: ModelRef | null;
  /** The REAL prompt version this call ran (`ASSESSOR_PROMPT_VERSION` when `ok`) — sessions.ts stores this verbatim instead of hardcoding a literal. */
  promptVersion: string | null;
  costUsd: number | null;
  /**
   * True cuando la LLAMADA al modelo falló (cadena agotada, rate-limit,
   * timeout, salida estructurada inválida, saldo agotado).
   *
   * Existe para separar dos hechos que antes eran indistinguibles desde
   * `sessions.ts`, porque los dos llegaban como `verdict: null`:
   *
   *   (a) el assessor NO PUDO correr  → hay un problema operativo
   *   (b) el assessor corrió y no hubo veredicto utilizable
   *
   * Importa porque toda la cadena pedagógica del turno (assessment,
   * agregación de mastery, racha, logros) vive detrás de una guarda sobre
   * `verdict`. Sin esta bandera, quedarse sin saldo de Anthropic hacía
   * desaparecer TODO el registro pedagógico **sin una sola línea de log**:
   * el tutor sigue respondiendo (es gemma, no depende de Anthropic), el
   * estudiante no nota nada, y el founder se queda con transcripciones y
   * cero assessments. `sessions.ts` ahora lo reporta explícitamente.
   */
  failed: boolean;
}

export async function runAssessor(
  modelDeps: Pick<ModelDeps, "createStructuredAdapter">,
  input: RunAssessorInput,
): Promise<AssessorOutcome> {
  const structuredAdapter = modelDeps.createStructuredAdapter(new NoopTelemetrySink());

  // AJUSTE 4: solo "en" se pasa a las opciones del prompt. "es" (o cualquier
  // otro valor) queda `undefined` para que el render sea byte-idéntico al
  // histórico y la versión persistida sea la default validada.
  const locale = input.locale === "en" ? "en" : undefined;

  const result = await structuredAdapter.generateStructured({
    task: input.task ?? "assessor",
    system: getAssessorSystemPrompt(input.subject, {
      topicLabeling: true,
      tutorLedRubric: true,
      ...(locale ? { locale } : {}),
    }),
    prompt: buildAssessorUserPrompt(input.messages, input.currentBand),
    schema: assessorSchema,
    promptVersion: locale ? ASSESSOR_PROMPT_VERSION_LOCALE : ASSESSOR_PROMPT_VERSION,
  });

  if (!result.ok) {
    return { verdict: null, topicKeyRaw: null, servedBy: null, promptVersion: null, costUsd: result.costUsd, failed: true };
  }
  return {
    verdict: result.object,
    topicKeyRaw: result.object.topicKey,
    servedBy: result.servedBy,
    promptVersion: result.promptVersion,
    costUsd: result.costUsd,
    failed: false,
  };
}
