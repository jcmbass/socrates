/**
 * Course — B3-modelo-de-dominio.md §2.4.
 *
 * `gradeLevelId` must reference a `GradeLevel` with `enabled: true` at
 * creation time — invariant I-7 (see invariants.ts).
 */
import { z } from "zod";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

export const COURSE_STATUSES = ["active", "archived"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export interface Course {
  id: string;
  /** FK User.id */
  userId: string;
  /** FK GradeLevel.id — invariante I-7. */
  gradeLevelId: string;
  /** Override del estudiante, opcional. */
  customLabel: string | null;
  /** Año calendario salvadoreño; null si no aplica (p.ej. universidad continua). */
  academicYear: number | null;
  status: CourseStatus;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

export const CourseSchema: z.ZodType<Course> = z.object({
  id: idSchema,
  userId: idSchema,
  gradeLevelId: idSchema,
  customLabel: z.string().min(1).nullable(),
  academicYear: z.number().int().nullable(),
  status: z.enum(COURSE_STATUSES),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  schemaVersion: schemaVersionSchema,
});
