/**
 * Consent — B3-modelo-de-dominio.md §2.2.
 *
 * Append-only ledger (invariant I-6, see invariants.ts): withdrawing
 * consent appends a new row with `status: "withdrawn"`, never edits or
 * deletes the acceptance row.
 */
import { z } from "zod";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

export const CONSENT_TYPES = [
  "terms_13plus",
  "privacy_policy",
  "data_processing",
  /**
   * NO se usa en etapa 1 (sin flujo parental in-app, DF-3; ningún grado
   * <13 años habilitado). Modelado hacia adelante porque el catálogo de
   * GradeLevel YA incluye 1º-9º grado (edades 6-15) sin habilitar — O-13.
   */
  "parental",
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CONSENT_STATUSES = ["accepted", "withdrawn"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export interface Consent {
  id: string;
  userId: string;
  type: ConsentType;
  status: ConsentStatus;
  /** Versión del texto legal aceptado (C5 es dueño del texto). */
  policyVersion: string;
  occurredAt: string;
  schemaVersion: number;
}

export const ConsentSchema: z.ZodType<Consent> = z.object({
  id: idSchema,
  userId: idSchema,
  type: z.enum(CONSENT_TYPES),
  status: z.enum(CONSENT_STATUSES),
  policyVersion: z.string().min(1),
  occurredAt: isoTimestampSchema,
  schemaVersion: schemaVersionSchema,
});
