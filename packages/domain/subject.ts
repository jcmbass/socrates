/**
 * Subject (materia) — B3-modelo-de-dominio.md §2.5.
 *
 * Not the same thing as `@buxo/core/subject`'s `resolveSubjectProfile`/
 * `sanitizeSubject`/`SubjectProfile` — those operate on the free-text
 * `name` string below at PROMPT-BUILD time (B1) and are never persisted;
 * this `Subject` is the persisted entity `name` is sanitized before being
 * stored into. `name` should be run through the same sanitization
 * discipline as `@buxo/core/subject`'s `sanitizeSubject` (control chars
 * stripped, whitespace collapsed, 60-char cap — prompt-injection surface,
 * R6) before being written here, but that sanitization is a write-path
 * concern (A2/C2), not re-implemented in this schema.
 */
import { z } from "zod";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

export interface Subject {
  id: string;
  /** Denormalizado — checks de ownership/cuota sin join. */
  userId: string;
  /** FK Course.id */
  courseId: string;
  /**
   * Texto libre, saneado (ver docblock del módulo). B1 resuelve el
   * SubjectProfile en tiempo de construcción del prompt a partir de este
   * string; el perfil NUNCA se persiste aquí — es derivado, no un hecho
   * guardado.
   */
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** Seed catalog provenance, e.g. "universidad/quimica". NULL for the student's own subject (C1-b). */
  seedCatalogKey: string | null;
  /** Material language frozen at activation time for a seed subject, e.g. "es" | "en" (C1-b). */
  seedLang: string | null;
  schemaVersion: number;
}

export const SubjectSchema: z.ZodType<Subject> = z.object({
  id: idSchema,
  userId: idSchema,
  courseId: idSchema,
  name: z.string().min(1).max(60),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  archivedAt: isoTimestampSchema.nullable(),
  seedCatalogKey: z.string().nullable(),
  seedLang: z.string().nullable(),
  schemaVersion: schemaVersionSchema,
});
