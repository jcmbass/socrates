/**
 * EducationSystem / EducationStage / GradeLevel / SubjectTemplate —
 * B3-modelo-de-dominio.md §2.3.
 *
 * Multi-country-shaped, El-Salvador-only-populated (O-13, DF-4): the
 * generic multi-country engine doesn't exist until country #2, but the
 * shape must not require remodeling that day. Seed data for El Salvador
 * lives in `data/el-salvador.ts`, not in this module (this module is
 * shape-only).
 */
import { z } from "zod";
import { idSchema, schemaVersionSchema } from "./common";

export interface EducationSystem {
  /** p.ej. "sv" */
  id: string;
  /** ISO 3166-1 alpha-2, p.ej. "SV" */
  countryCode: string;
  /** Clave i18n — D1 la localiza. */
  nameKey: string;
  /** Fallback de autoría del seed: "El Salvador". */
  defaultName: string;
  /** DF-4: solo "sv" activo en etapa 1. */
  active: boolean;
  schemaVersion: number;
}

export const EducationSystemSchema: z.ZodType<EducationSystem> = z.object({
  id: idSchema,
  countryCode: z.string().length(2),
  nameKey: z.string().min(1),
  defaultName: z.string().min(1),
  active: z.boolean(),
  schemaVersion: schemaVersionSchema,
});

export interface EducationStage {
  /** Scoped al sistema, p.ej. "sv-basica". */
  id: string;
  /** FK EducationSystem.id */
  systemId: string;
  /** Orden de progresión dentro del sistema. */
  order: number;
  labelKey: string;
  /** "Educación básica" | "Bachillerato" | "Universidad" */
  defaultLabel: string;
  schemaVersion: number;
}

export const EducationStageSchema: z.ZodType<EducationStage> = z.object({
  id: idSchema,
  systemId: idSchema,
  order: z.number().int().min(0),
  labelKey: z.string().min(1),
  defaultLabel: z.string().min(1),
  schemaVersion: schemaVersionSchema,
});

export interface GradeLevel {
  /** Scoped, p.ej. "sv-bachillerato-1". */
  id: string;
  /** FK EducationSystem.id */
  systemId: string;
  /** FK EducationStage.id */
  stageId: string;
  /** Orden dentro de la etapa (1..9, 1..3, 1..10). */
  order: number;
  labelKey: string;
  /** "1º grado" | "1° año de bachillerato" | "Ciclo 1" */
  defaultLabel: string;
  /** básica: 6..14; bachillerato: ~15..17; universidad: null (variable). */
  typicalAgeMin: number | null;
  typicalAgeMax: number | null;
  /**
   * Gate de habilitación por etapa de PRODUCTO (no por schema). Etapa 1:
   * true SOLO para bachillerato (3 niveles) y universidad (10 ciclos);
   * false para básica (9 niveles, edades 6-15). Ver invariante I-7:
   * `Course.gradeLevelId` solo puede apuntar a un GradeLevel con
   * `enabled: true` en el momento de creación del curso.
   */
  enabled: boolean;
  schemaVersion: number;
}

export const GradeLevelSchema: z.ZodType<GradeLevel> = z.object({
  id: idSchema,
  systemId: idSchema,
  stageId: idSchema,
  order: z.number().int().min(0),
  labelKey: z.string().min(1),
  defaultLabel: z.string().min(1),
  typicalAgeMin: z.number().int().nullable(),
  typicalAgeMax: z.number().int().nullable(),
  enabled: z.boolean(),
  schemaVersion: schemaVersionSchema,
});

/**
 * A2 "plantillas por país/curso para arrancar rápido": materias sugeridas
 * para un GradeLevel. Puramente informativo — A2 las usa para prellenar,
 * nunca las hace obligatorias ni bloquea crear una Subject fuera de la
 * lista. Per `02-validacion-arquitecto.md` ("producto R-2"): NO existe una
 * entidad `Career`/plantilla universitaria en etapa 1 — universidad arranca
 * con materias creadas por el estudiante; `SubjectTemplate` solo se puebla
 * para bachillerato (ver `data/el-salvador.ts`).
 */
export interface SubjectTemplate {
  id: string;
  /** FK GradeLevel.id */
  gradeLevelId: string;
  order: number;
  nameKey: string;
  /** "Matemática", "Física", "Historia de El Salvador", ... */
  defaultName: string;
  schemaVersion: number;
}

export const SubjectTemplateSchema: z.ZodType<SubjectTemplate> = z.object({
  id: idSchema,
  gradeLevelId: idSchema,
  order: z.number().int().min(0),
  nameKey: z.string().min(1),
  defaultName: z.string().min(1),
  schemaVersion: schemaVersionSchema,
});
