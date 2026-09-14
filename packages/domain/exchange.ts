/**
 * Exchange — B3-modelo-de-dominio.md §2.8.
 *
 * B3 §0 point 1: `Exchange` moves from an array item (positional index) in
 * the alfa to a first-class entity with a stable `id` — `Assessment` needs
 * to FK it robustly (invariant I-1), and an array index isn't a safe
 * identity across edits/migrations. This is a NEW shape, not a re-export
 * of `@buxo/core/transcript`'s `Exchange`: it keeps that type's
 * `studentMessage`/`tutorReply`/`band`/`timestamp`/`hintOffered`/
 * `studentCorrect` fields verbatim (same names, same semantics — see B3
 * §5.2's migration mapping) but adds `id`/`sessionId`/`index` (identity)
 * and the O-9 version-provenance blocks (`tutor*`/`judge*`) that
 * `@buxo/core/transcript`'s `Exchange` never carried. `Band` itself is
 * reused as-is from `@buxo/core/prompts`.
 */
import { z } from "zod";
import type { Band } from "@buxo/core/prompts";
import { BANDS } from "@buxo/core/prompts";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

export interface Exchange {
  /**
   * NUEVO vs. la alfa (que solo tenía posición de array). Estable y
   * determinístico en la migración: `${sessionId}:${index}` (B3 §4, §5.2).
   */
  id: string;
  /** FK StudySession.id */
  sessionId: string;
  /** Ordinal dentro de la sesión (0-based), para orden/display. */
  index: number;
  timestamp: string;

  /** @sensitive */
  studentMessage: string;
  /** @sensitive */
  tutorReply: string;
  /** Banda bajo la cual el tutor produjo tutorReply. */
  band: Band;

  // Procedencia del lado TUTOR (O-9).
  /** p.ej. PROMPT_VERSION de @buxo/core/prompts (B1). */
  tutorPromptVersion: string;
  tutorModelId: string;
  /** Clave de proveedor del adaptador C7 (DF-1). */
  tutorProviderId: string;

  // Veredicto del judge SOBRE este exchange — out-of-band, puede fallar o
  // no correr (D3: judge muestreado).
  hintOffered: boolean | null;
  studentCorrect: boolean | null;
  /** null sii el judge no corrió/falló. */
  judgePromptVersion: string | null;
  judgeModelId: string | null;
  judgeProviderId: string | null;

  schemaVersion: number;
}

export const ExchangeSchema: z.ZodType<Exchange> = z.object({
  id: idSchema,
  sessionId: idSchema,
  index: z.number().int().min(0),
  timestamp: isoTimestampSchema,

  studentMessage: z.string(),
  tutorReply: z.string(),
  band: z.enum(BANDS),

  tutorPromptVersion: z.string().min(1),
  tutorModelId: z.string().min(1),
  tutorProviderId: z.string().min(1),

  hintOffered: z.boolean().nullable(),
  studentCorrect: z.boolean().nullable(),
  judgePromptVersion: z.string().min(1).nullable(),
  judgeModelId: z.string().min(1).nullable(),
  judgeProviderId: z.string().min(1).nullable(),

  schemaVersion: schemaVersionSchema,
});
