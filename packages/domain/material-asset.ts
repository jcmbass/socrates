/**
 * MaterialAsset — B3-modelo-de-dominio.md §2.6.
 *
 * `MaterialStorageRef` and `MaterialProcessingEntry` are value objects
 * embedded in `MaterialAsset` (B3 §1: no own store/schemaVersion).
 * `MaterialProcessingEntry` has the same fields as `ProcessingReport`
 * (`apps/harness/lib/pdf/orchestrate.ts`, C4) — promoted here to a
 * persisted, versioned shape (`MaterialAsset.digestionPipelineVersion`),
 * not imported from the harness (that file is React/Next-adjacent, out of
 * bounds for this package's purity gate).
 */
import { z } from "zod";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

export const MATERIAL_KINDS = ["pdf", "photo", "paste", "txt"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MATERIAL_DIGESTION_STATUSES = [
  "pending",
  "digesting",
  "ready",
  /** Algunas páginas/figuras fallaron (marcador honesto, C4 §5/§9), el resto es utilizable. */
  "partial",
  "failed",
] as const;
export type MaterialDigestionStatus = (typeof MATERIAL_DIGESTION_STATUSES)[number];

export const MATERIAL_STORAGE_LOCATIONS = ["device_only", "cloud_blob"] as const;
export type MaterialStorageLocation = (typeof MATERIAL_STORAGE_LOCATIONS)[number];

/**
 * Dónde viven los BYTES crudos (PDF/foto) — distinto de dónde vive el texto
 * digerido (`MaterialAsset.digestedTextRef`). "device_only" es el caso
 * local-first puro: el archivo nunca salió del dispositivo, solo su texto
 * extraído (y solo si la extracción también fue local).
 */
export interface MaterialStorageRef {
  location: MaterialStorageLocation;
  /** Clave/URL opaca cuando `location === "cloud_blob"`; null en "device_only" o kind:"paste". */
  blobRef: string | null;
}

export const MaterialStorageRefSchema: z.ZodType<MaterialStorageRef> = z.object({
  location: z.enum(MATERIAL_STORAGE_LOCATIONS),
  blobRef: z.string().min(1).nullable(),
});

export const MATERIAL_PROCESSING_ROUTES = ["local", "cloud-figure", "cloud-page"] as const;
export type MaterialProcessingRoute = (typeof MATERIAL_PROCESSING_ROUTES)[number];

/** Mismos campos que ProcessingReport (lib/pdf/orchestrate.ts, C4) — promovidos a forma persistida y versionada. PB2: costUsd nullable (null = costo no medible). */
export interface MaterialProcessingEntry {
  /** null para kinds no paginados (photo, paste, txt). */
  page: number | null;
  route: MaterialProcessingRoute;
  costUsd: number | null;
  cached: boolean;
  /**
   * Wall-clock timings (ms) for the cloud-page path. Additive/optional so
   * older clients and `local` rows stay valid without these fields.
   * When `cached: true`, must be 0 or null — never reuse another run's
   * measurements (a cached hit did not pay that cost this request).
   */
  rasterMs?: number | null;
  modelMs?: number | null;
  safetyMs?: number | null;
  totalMs?: number | null;
}

export const MaterialProcessingEntrySchema: z.ZodType<MaterialProcessingEntry> = z.object({
  page: z.number().int().min(0).nullable(),
  route: z.enum(MATERIAL_PROCESSING_ROUTES),
  costUsd: z.number().min(0).nullable(),
  cached: z.boolean(),
  rasterMs: z.number().min(0).nullable().optional(),
  modelMs: z.number().min(0).nullable().optional(),
  safetyMs: z.number().min(0).nullable().optional(),
  totalMs: z.number().min(0).nullable().optional(),
});

export interface MaterialAsset {
  id: string;
  /** Denormalizado. */
  userId: string;
  /** FK Subject.id */
  subjectId: string;
  kind: MaterialKind;
  originalFilename: string | null;
  createdAt: string;
  /** Máquina de estados — invariante I-8. */
  status: MaterialDigestionStatus;
  /** @sensitive cuando embebe notas/fotos propias del estudiante. */
  storage: MaterialStorageRef;
  /**
   * Puntero opaco (hash de contenido, p.ej. sha256 del texto normalizado)
   * al texto extraído. @sensitive. Direccionado por contenido: subir el
   * mismo material dos veces dedupe al mismo blob sin re-digerir.
   */
  digestedTextRef: string;
  tokenCount: number | null;
  /** lib/truncate.ts's TruncateResult, promovido a hecho persistido. */
  truncated: boolean;
  droppedTokens: number;
  processingReport: MaterialProcessingEntry[];
  /**
   * Versión del pipeline de ingesta (tiered pdf.js + fallback Haiku,
   * docs/plan-local-litert/) que produjo este digest — mismo espíritu de
   * O-9 aplicado a la ingesta.
   */
  digestionPipelineVersion: string;
  /** Soft-delete / "reemplazar" (A3). */
  removedAt: string | null;
  schemaVersion: number;
}

export const MaterialAssetSchema: z.ZodType<MaterialAsset> = z.object({
  id: idSchema,
  userId: idSchema,
  subjectId: idSchema,
  kind: z.enum(MATERIAL_KINDS),
  originalFilename: z.string().min(1).nullable(),
  createdAt: isoTimestampSchema,
  status: z.enum(MATERIAL_DIGESTION_STATUSES),
  storage: MaterialStorageRefSchema,
  digestedTextRef: z.string().min(1),
  tokenCount: z.number().int().min(0).nullable(),
  truncated: z.boolean(),
  droppedTokens: z.number().int().min(0),
  processingReport: z.array(MaterialProcessingEntrySchema),
  digestionPipelineVersion: z.string().min(1),
  removedAt: isoTimestampSchema.nullable(),
  schemaVersion: schemaVersionSchema,
});
