/**
 * MigrationRecord (meta) — B3-modelo-de-dominio.md §2.13.
 *
 * One row per (entityType, applied version) — audit trail of schema
 * migrations run. Engine-agnostic: C2 decides the real mechanism. Unlike
 * every other first-class entity in this package, `MigrationRecord` does
 * NOT carry its own `schemaVersion` (B3's interface omits it — this entity
 * describes migrations of OTHER entities' schemas, not its own).
 */
import { z } from "zod";
import { idSchema, isoTimestampSchema } from "./common";

export const MIGRATION_APPLIED_BY = ["lazy_on_read", "backfill_job", "manual"] as const;
export type MigrationAppliedBy = (typeof MIGRATION_APPLIED_BY)[number];

export interface MigrationRecord {
  id: string;
  /** "User" | "StudySession" | "Exchange" | ... — coincide con las interfaces de B3 §2. */
  entityType: string;
  fromVersion: number;
  toVersion: number;
  appliedAt: string;
  appliedBy: MigrationAppliedBy;
  /** null cuando se desconoce de antemano (una migración lazy no cuenta por adelantado). */
  affectedCount: number | null;
}

export const MigrationRecordSchema: z.ZodType<MigrationRecord> = z.object({
  id: idSchema,
  entityType: z.string().min(1),
  fromVersion: z.number().int().min(0),
  toVersion: z.number().int().min(0),
  appliedAt: isoTimestampSchema,
  appliedBy: z.enum(MIGRATION_APPLIED_BY),
  affectedCount: z.number().int().min(0).nullable(),
});
