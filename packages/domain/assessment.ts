/**
 * Assessment — B3-modelo-de-dominio.md §2.9.
 *
 * `demonstratedUnderstanding`'s type is reused from `@buxo/core/session`'s
 * `DemonstratedUnderstanding` (B3 §1: "vive hoy en lib/session.ts pero es
 * vocabulario del assessor ... B3 lo sigue usando por compatibilidad"). The
 * literal tuple is re-declared here (not exported by `@buxo/core/session`)
 * to build the zod enum — the four strings are load-bearing and must stay
 * byte-identical to `@buxo/core/session`'s internal
 * `DEMONSTRATED_UNDERSTANDING_LEVELS`; see the round-trip test in
 * `__tests__/assessment.test.ts`.
 *
 * `topicKey` is a B3 PROPOSAL (§0 point 4, §8 R-3), not yet a settled fact
 * per `02-validacion-arquitecto.md` ("R-3 (identidad de "tema") ... NECESITA
 * VISTO BUENO DE B2" — not listed among the resolved items in that
 * document's table). Modeled here exactly as B3 specifies pending that
 * confirmation.
 */
import { z } from "zod";
import type { Band } from "@buxo/core/prompts";
import { BANDS } from "@buxo/core/prompts";
import type { DemonstratedUnderstanding } from "@buxo/core/session";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

/** Must stay byte-identical to @buxo/core/session's internal DEMONSTRATED_UNDERSTANDING_LEVELS. */
export const DEMONSTRATED_UNDERSTANDING_LEVELS = ["none", "weak", "developing", "solid"] as const;

export interface Assessment {
  id: string;
  /** FK StudySession.id — denormalizado, evita join a través de Exchange para scoping por sesión. */
  sessionId: string;
  /** FK Exchange.id — invariante I-1. */
  exchangeId: string;
  /** Denormalizado desde la sesión — consultas de agregación de B2. */
  subjectId: string;
  timestamp: string;

  demonstratedUnderstanding: DemonstratedUnderstanding;
  explainedInOwnWords: boolean;
  guessedOrPatternMatched: boolean;
  recommendedBand: Band;
  /** Nunca al estudiante (sin cambio vs. alfa) — @sensitive-adjacent, B3 §6. */
  rationale: string;

  /**
   * PROPUESTA de B3 — semilla de identidad de "tema" (texto libre
   * normalizado: minúsculas, recortado, slug ascii), etiquetado por el
   * assessor en la misma llamada que produce el veredicto. Scoped a
   * `subjectId` (invariante I-9): nunca se agrega entre materias por
   * coincidencia de string. `null` cuando la llamada corrió sin etiquetado.
   */
  topicKey: string | null;

  assessorPromptVersion: string;
  assessorModelId: string;
  assessorProviderId: string;

  schemaVersion: number;
}

export const AssessmentSchema: z.ZodType<Assessment> = z.object({
  id: idSchema,
  sessionId: idSchema,
  exchangeId: idSchema,
  subjectId: idSchema,
  timestamp: isoTimestampSchema,

  demonstratedUnderstanding: z.enum(DEMONSTRATED_UNDERSTANDING_LEVELS),
  explainedInOwnWords: z.boolean(),
  guessedOrPatternMatched: z.boolean(),
  recommendedBand: z.enum(BANDS),
  rationale: z.string(),

  topicKey: z.string().min(1).nullable(),

  assessorPromptVersion: z.string().min(1),
  assessorModelId: z.string().min(1),
  assessorProviderId: z.string().min(1),

  schemaVersion: schemaVersionSchema,
});
