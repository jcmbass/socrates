/**
 * Shared vocabulary for @buxo/models (C7) — packages/models/task.ts.
 *
 * Design context: `docs/plan-app-multiplataforma/especificaciones/C-backend-plataforma.md`
 * §1.1's table names four tasks (tutor, assessor, judge, ingest_vision).
 * The F1/WP4 mandate (`docs/plan-app-multiplataforma/04-plan-f1.md` Ola 3)
 * asks for five: "tutor | assessor | judge | ingest | safety". This module
 * follows the mandate literally:
 *
 *   - `ingest_vision` is renamed `ingest` (same task, C4's ingestion model
 *     selection — `lib/ingest/model.ts` today).
 *   - `safety` is NEW versus the spec's §1.1 table, but not invented out of
 *     nothing: §3.1 of the same spec describes the input-safety classifier
 *     as "mismo modelo/peldaño barato que el resto de C7, mismo tratamiento
 *     de registro de capacidades y gate para su structured output" — i.e.
 *     the spec already intends the safety classifier to be a first-class C7
 *     task, just without naming it in the §1.1 table (written before §3 was
 *     drafted). Treating it as a fifth `TaskKind` here is a direct
 *     extrapolation, not a deviation from intent.
 *
 * No side effects, no I/O — this file is pure vocabulary shared by every
 * other module in this package.
 */
import { z } from "zod";

export const TASK_KINDS = [
  "tutor",
  "assessor",
  "judge",
  "ingest",
  "safety",
  "temario-builder",
  "mastery-assessor",
  "guided-items",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const ENVIRONMENTS = ["dev", "staging", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/**
 * A single (provider, model) candidate — C-backend-plataforma.md §1.3.
 * `providerId`/`modelId` naming matches `@buxo/domain`'s `Exchange.tutorProviderId`/
 * `tutorModelId` (and the `assessor*`/`judge*` equivalents) field names by
 * convention (O-9 procedencia) — see packages/models/execution/*.ts.
 */
export interface ModelRef {
  providerId: string;
  modelId: string;
}

export const ModelRefSchema: z.ZodType<ModelRef> = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});

/** `"anthropic:claude-sonnet-5"` — used in error messages, telemetry, and env-var chain parsing. */
export function formatModelRef(ref: ModelRef): string {
  return `${ref.providerId}:${ref.modelId}`;
}

export function modelRefKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function modelRefEquals(a: ModelRef, b: ModelRef): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId;
}
