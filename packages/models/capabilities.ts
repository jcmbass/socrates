/**
 * The capabilities registry TYPE — C-backend-plataforma.md §1.2.
 *
 * "C7 nunca confía en la tabla de capacidades del AI SDK." The lección de
 * fase 4 (`docs/LECCIONES-Y-BUGS.md`, 2026-07-11): `@ai-sdk/anthropic@4.0.1`'s
 * internal `getModelCapabilities` has no branch for `"claude-sonnet-5"` →
 * assumes `supportsStructuredOutput: false` → silently degrades to a
 * schema-less tool fallback that is flaky with long prompts. C7's answer is
 * to never ask the SDK "does this model support X" — it asks ITS OWN
 * registry (packages/models/registry.ts), populated by hand after reading
 * provider docs and/or running the O-14 gate (packages/models/gate.ts).
 *
 * `ModelCapabilities` here is intentionally a SUPERSET of the shape in
 * C-backend-plataforma.md §1.2 — see the two documented deviations below.
 */
import { z } from "zod";
import type { TaskKind } from "./task";

/**
 * - "native_schema": the provider validates the JSON schema server-side
 *   (best case).
 * - "native_json_mode": JSON is guaranteed but not validated against the
 *   schema server-side.
 * - "tool_fallback": structured output is forced via a synthetic tool call
 *   — fragile with long prompts (this is the fase-4 bug's shape when it's
 *   NOT the registry's own deliberate choice but an SDK degrading silently;
 *   here it means "this model/host genuinely has no better option").
 * - "none": no structured output support at all — a task requiring it must
 *   skip this candidate.
 */
export const STRUCTURED_OUTPUT_SUPPORT_VALUES = [
  "native_schema",
  "native_json_mode",
  "tool_fallback",
  "none",
] as const;
export type StructuredOutputSupport = (typeof STRUCTURED_OUTPUT_SUPPORT_VALUES)[number];

export const PROMPT_CACHING_VALUES = ["none", "automatic", "explicit_breakpoints"] as const;
export type PromptCaching = (typeof PROMPT_CACHING_VALUES)[number];

/**
 * DEVIATION 1 (documented): §1.2's literal shape has `gateStatus` nowhere —
 * O-14's gate (§1.4) is described in prose as a separate process. WP4's
 * mandate explicitly asks for "marcando gateStatus (p.ej. 'validated' solo
 * para lo que ya pasó gate real hoy ...; el resto 'pending_gate')", so this
 * field is added to make that enforceable in code — see gate.ts's
 * `isServableForTask`, which reads it to block ungated candidates from
 * serving ANY task outside dev+explicit-flag (architect's ruling
 * 2026-07-14, per the vision doc's principio 7: "Todo modelo nuevo entra
 * por gate de validación antes de servir tráfico" — no task qualifier).
 * Note this field is per-(provider,model) today while gating is
 * conceptually per-task — see the TODO(model-migration) in gate.ts.
 */
export const GATE_STATUS_VALUES = ["validated", "pending_gate"] as const;
export type GateStatus = (typeof GATE_STATUS_VALUES)[number];

/**
 * Gate status por-tarea (TODO(model-migration) de gate.ts, implementado en
 * F3 de la migración DeepInfra, 2026-08-11): un mapa parcial `TaskKind →
 * GateStatus`. Las tareas NO mencionadas quedan en "pending_gate" (deny by
 * default) — un modelo que pasó el gate de tutor NO debe servir assessor en
 * silencio. El valor único (`GateStatus`) sigue significando "igual para
 * toda tarea" y es lo que usan todas las filas pre-migración (sin cambio de
 * comportamiento).
 */
export type GateStatusByTask = Partial<Record<TaskKind, GateStatus>>;

/**
 * Cost model discriminator (F3 G5).
 *
 * - `"per-token"`: the model is priced per million tokens (APIs like
 *   Anthropic, OpenRouter, Together). `pricePerMTokIn/Out` must be non-null
 *   when `gateStatus === "validated"` (PB2 invariant).
 * - `"self-hosted"`: the model runs on owned/rented hardware (VPS with GPU).
 *   Marginal cost per call is effectively 0; the fixed monthly cost is
 *   attributed via `fixedCostRef`. `pricePerMTokIn/Out` MUST be null (no
 *   per-token pricing applies). `fixedCostRef` is required when
 *   `gateStatus === "validated"`.
 */
export const COST_MODEL_VALUES = ["per-token", "self-hosted"] as const;
export type CostModel = (typeof COST_MODEL_VALUES)[number];

export const VERIFIED_BY_VALUES = ["gate_suite", "manual_docs_review"] as const;
export type VerifiedBy = (typeof VERIFIED_BY_VALUES)[number];

export interface ModelCapabilities {
  providerId: string;
  modelId: string;
  structuredOutputSupport: StructuredOutputSupport;
  /**
   * The EXACT providerOptions to force the correct mode — not a promise
   * that "it should work by default". Real example (the fase-4 fix):
   *   { anthropic: { structuredOutputMode: "outputFormat" } }
   * `null` when no forcing is known to be needed/available for this row.
   */
  structuredOutputForce: Record<string, unknown> | null;
  toolUse: boolean;
  vision: boolean;
  streaming: boolean;
  promptCaching: PromptCaching;
  /**
   * DEVIATION 2 (documented): §1.2 types these as required `number`. The
   * spec text (§1.2, §1.6) never states a context/output token ceiling for
   * ANY candidate — inventing one would violate the task's explicit "NO
   * inventes números" rule, and worse, would silently reintroduce exactly
   * the failure mode this package exists to prevent (asserting a capability
   * nobody verified). Widened to `number | null`; every row below is `null`
   * with a `TODO(gate)` pending real verification.
   */
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  pricePerMTokIn: number | null;
  pricePerMTokOut: number | null;
  /**
   * Cost model discriminator (F3 G5). `"per-token"` for API-priced models
   * (default); `"self-hosted"` for models on owned/rented hardware where
   * marginal cost per call is 0. When `"self-hosted"`, `pricePerMTokIn/Out`
   * MUST be null and `fixedCostRef` is required at `gateStatus === "validated"`.
   */
  costModel: CostModel;
  /**
   * Reference to the fixed-cost infrastructure line item in the D3 economics
   * doc (e.g. `"VPS-1: NVIDIA A100 80GB @ USD 1,200/mes"`). Non-null only
   * when `costModel === "self-hosted"` and `gateStatus === "validated"`.
   * For `"per-token"` models this is always `null`.
   */
  fixedCostRef: string | null;
  notes: string;
  verifiedAt: string;
  verifiedBy: VerifiedBy;
  /**
   * See DEVIATION 1 above. Valor único (igual para toda tarea) O mapa
   * parcial por `TaskKind` (tareas ausentes = pending_gate). Ver
   * `gate.ts:isServableForTask`/`gateStatusForTask`.
   */
  gateStatus: GateStatus | GateStatusByTask;
}

export const ModelCapabilitiesSchema: z.ZodType<ModelCapabilities> = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  structuredOutputSupport: z.enum(STRUCTURED_OUTPUT_SUPPORT_VALUES),
  structuredOutputForce: z.record(z.string(), z.unknown()).nullable(),
  toolUse: z.boolean(),
  vision: z.boolean(),
  streaming: z.boolean(),
  promptCaching: z.enum(PROMPT_CACHING_VALUES),
  maxContextTokens: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  pricePerMTokIn: z.number().nonnegative().nullable(),
  pricePerMTokOut: z.number().nonnegative().nullable(),
  costModel: z.enum(COST_MODEL_VALUES),
  fixedCostRef: z.string().nullable(),
  notes: z.string(),
  verifiedAt: z.string().min(1),
  verifiedBy: z.enum(VERIFIED_BY_VALUES),
  gateStatus: z.union([
    z.enum(GATE_STATUS_VALUES),
    // Mapa parcial por-tarea: objeto explícito con las 6 TaskKinds opcionales
    // (z.record con clave-enum en Zod 4 exige TODAS las claves, no es lo que
    // queremos — un mapa parcial es un subconjunto).
    z.object({
      tutor: z.enum(GATE_STATUS_VALUES).optional(),
      assessor: z.enum(GATE_STATUS_VALUES).optional(),
      judge: z.enum(GATE_STATUS_VALUES).optional(),
      ingest: z.enum(GATE_STATUS_VALUES).optional(),
      safety: z.enum(GATE_STATUS_VALUES).optional(),
      "temario-builder": z.enum(GATE_STATUS_VALUES).optional(),
      "mastery-assessor": z.enum(GATE_STATUS_VALUES).optional(),
      "guided-items": z.enum(GATE_STATUS_VALUES).optional(),
    }),
  ]),
});

/**
 * Cost estimate for D3 — generalizes `apps/harness/lib/ingest/pricing.ts`'s
 * `estimateCostUsd` to any registry row instead of a hardcoded model-string
 * table.
 *
 * Returns:
 * - `0` when `costModel === "self-hosted"` (zero marginal cost by design —
 *   the fixed monthly VPS/GPU cost is attributed via `fixedCostRef`).
 * - `null` when `costModel === "per-token"` and either price is unknown
 *   (never fabricates a number from a partial price — this is the
 *   `pending_gate` case).
 * - A positive number when `costModel === "per-token"` and both prices are
 *   known.
 *
 * **Critical distinction (F3 G5):** `null` means "cost not measurable /
 * unconfirmed" (pending_gate). `0` means "zero marginal cost by design"
 * (self-hosted). Downstream consumers (`recordUsage` in quotas.ts) use
 * `costUsd === null` to set the `costUsdIncomplete` flag — self-hosted
 * calls with `costUsd = 0` will NOT set that flag, which is correct: the
 * cost IS known (it's 0 marginal).
 */
export function estimateCostUsd(
  capabilities: Pick<ModelCapabilities, "pricePerMTokIn" | "pricePerMTokOut" | "costModel">,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (capabilities.costModel === "self-hosted") return 0;
  if (capabilities.pricePerMTokIn === null || capabilities.pricePerMTokOut === null) return null;
  return (inputTokens * capabilities.pricePerMTokIn) / 1e6 + (outputTokens * capabilities.pricePerMTokOut) / 1e6;
}
