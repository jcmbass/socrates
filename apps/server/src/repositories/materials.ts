/**
 * MaterialAsset persistence.
 *
 * Idempotency (same spirit as turn_claims / beta-real 10): when the client
 * sends `clientUploadId`, we INSERT a `digesting` row BEFORE running the
 * pipeline. A retry with the same key hits the unique index and returns
 * `duplicate` — never a second digest, never a second quota charge.
 *
 * Why the row is created at the start (not only at the end): while the
 * server is rasterizing / calling vision, the student may kill the app.
 * Without a consultable row, GET /v1/materials looks empty and the
 * student thinks the ingest was lost even though the server is still
 * working. `status: "digesting"` is the vocabulary `@buxo/domain` already
 * defines for that window.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { materialAssets } from "../db/schema";
import type { MaterialAsset, MaterialDigestionStatus, MaterialKind, MaterialProcessingEntry } from "@buxo/domain/material-asset";
import { newId, nowIso } from "./ids";

/**
 * A `digesting` row older than this is a zombie: the request worker died
 * (Render free-tier kill, OOM, deploy) and will never finish.
 *
 * Why 20 minutes: measured cloud-page digests on Render free have hit
 * ~4 minutes for 2 pages; the per-upload page cap is 20, so a worst-case
 * cloud-heavy PDF can approach ~10 minutes wall-clock plus cold start.
 * 20 minutes is 2× that ceiling — holgado enough that a slow-but-alive
 * digest is not marked failed, tight enough that a dead worker does not
 * leave the student staring at "procesando" forever.
 *
 * Same role as TURN_CLAIM_ORPHAN_MS for turn_claims.
 */
export const MATERIAL_DIGEST_ORPHAN_MS = 20 * 60 * 1000;

function rowToMaterial(row: typeof materialAssets.$inferSelect): MaterialAsset {
  return {
    id: row.id,
    userId: row.userId,
    subjectId: row.subjectId,
    kind: row.kind,
    originalFilename: row.originalFilename,
    createdAt: row.createdAt,
    status: row.status,
    storage: row.storage,
    digestedTextRef: row.digestedTextRef,
    tokenCount: row.tokenCount,
    truncated: row.truncated,
    droppedTokens: row.droppedTokens,
    processingReport: row.processingReport,
    digestionPipelineVersion: row.digestionPipelineVersion,
    removedAt: row.removedAt,
    schemaVersion: row.schemaVersion,
  };
}

export interface CreateMaterialInput {
  userId: string;
  subjectId: string;
  kind: MaterialKind;
  originalFilename?: string | null;
  /**
   * F1/WP5 DEVIATION (still true for F2 WQ1): `@buxo/domain`'s
   * `digestedTextRef` docblock describes an opaque content-addressed
   * pointer into a separate text blob store. No such store exists yet — the
   * digested text (whether it's a `kind:"paste"` verbatim string or F2
   * WQ1's server-assembled PDF markdown) is stored INLINE in this column
   * instead of behind a pointer. Flagged for architect review; not a silent
   * shortcut. `IngestCache`-shaped shared blob storage (C4 §3.5) is future work.
   */
  digestedText: string;
  status: MaterialDigestionStatus;
  /** F2 WQ1 — per-page cost/route trail (`@buxo/domain`'s `MaterialProcessingEntry[]`). Defaults to `[]` (the `paste` path has nothing to report). */
  processingReport?: MaterialProcessingEntry[];
  /** F2 WQ1 — distinguishes the server-raster pipeline's rows from WP5's `kind:"paste"` inline-text rows in `digestionPipelineVersion` (O-9-style provenance). Defaults to the WP5 value for backward compat. */
  digestionPipelineVersion?: string;
  /** Optional idempotency key — see module doc. */
  clientUploadId?: string | null;
}

function materialInsertValues(input: CreateMaterialInput) {
  return {
    id: newId(),
    userId: input.userId,
    subjectId: input.subjectId,
    kind: input.kind,
    originalFilename: input.originalFilename ?? null,
    createdAt: nowIso(),
    status: input.status,
    storage: { location: "cloud_blob" as const, blobRef: null },
    digestedTextRef: input.digestedText,
    tokenCount: input.status === "ready" || input.status === "partial" ? Math.ceil(input.digestedText.length / 4) : null,
    truncated: false,
    droppedTokens: 0,
    processingReport: input.processingReport ?? [],
    digestionPipelineVersion: input.digestionPipelineVersion ?? "wp5-inline-v1",
    removedAt: null,
    schemaVersion: 1,
    clientUploadId: input.clientUploadId ?? null,
  };
}

export async function createMaterial(db: Db, input: CreateMaterialInput): Promise<MaterialAsset> {
  const [row] = await db.insert(materialAssets).values(materialInsertValues(input)).returning();
  return rowToMaterial(row);
}

/**
 * Same insert as `createMaterial`, but with the unique `(userId, clientUploadId)`
 * claim used by paste / photo / txt. Duplicate key → `{ kind: "duplicate" }`
 * (caller maps to 409), never a second row. Without `clientUploadId` this is
 * identical to `createMaterial` (pre-idempotency).
 */
export async function claimOrCreateMaterial(
  db: Db,
  input: CreateMaterialInput,
): Promise<ClaimMaterialUploadResult> {
  if (!input.clientUploadId) {
    return { kind: "acquired", material: await createMaterial(db, input) };
  }

  const values = materialInsertValues(input);
  const inserted = await db
    .insert(materialAssets)
    .values(values)
    .onConflictDoNothing({
      target: [materialAssets.userId, materialAssets.clientUploadId],
    })
    .returning();

  if (inserted[0]) {
    return { kind: "acquired", material: rowToMaterial(inserted[0]) };
  }

  const [existing] = await db
    .select()
    .from(materialAssets)
    .where(
      and(
        eq(materialAssets.userId, input.userId),
        eq(materialAssets.clientUploadId, input.clientUploadId),
      ),
    )
    .limit(1);

  if (!existing) {
    const [retry] = await db.insert(materialAssets).values(values).returning();
    return { kind: "acquired", material: rowToMaterial(retry) };
  }

  return { kind: "duplicate", material: rowToMaterial(existing) };
}

export type ClaimMaterialUploadResult =
  | { kind: "acquired"; material: MaterialAsset }
  | { kind: "duplicate"; material: MaterialAsset };

export interface BeginMaterialDigestInput {
  userId: string;
  subjectId: string;
  kind: MaterialKind;
  originalFilename?: string | null;
  digestionPipelineVersion: string;
  /** Required for idempotent claim; omit only for legacy callers. */
  clientUploadId?: string | null;
  now: Date;
}

/**
 * Persist a `digesting` row BEFORE the pipeline runs.
 *
 * With `clientUploadId`: atomic claim via INSERT … ON CONFLICT DO NOTHING.
 * Orphan `digesting` rows (older than MATERIAL_DIGEST_ORPHAN_MS) are
 * reclaimable so a dead worker cannot permanently block that key.
 *
 * Without `clientUploadId`: always inserts (pre-idempotency behaviour).
 */
export async function beginMaterialDigest(
  db: Db,
  input: BeginMaterialDigestInput,
): Promise<ClaimMaterialUploadResult> {
  const createdAt = input.now.toISOString();
  const values = {
    id: newId(),
    userId: input.userId,
    subjectId: input.subjectId,
    kind: input.kind,
    originalFilename: input.originalFilename ?? null,
    createdAt,
    status: "digesting" as const,
    storage: { location: "cloud_blob" as const, blobRef: null },
    digestedTextRef: "",
    tokenCount: null,
    truncated: false,
    droppedTokens: 0,
    processingReport: [] as MaterialProcessingEntry[],
    digestionPipelineVersion: input.digestionPipelineVersion,
    removedAt: null,
    schemaVersion: 1,
    clientUploadId: input.clientUploadId ?? null,
  };

  if (!input.clientUploadId) {
    const [row] = await db.insert(materialAssets).values(values).returning();
    return { kind: "acquired", material: rowToMaterial(row) };
  }

  const inserted = await db
    .insert(materialAssets)
    .values(values)
    .onConflictDoNothing({
      target: [materialAssets.userId, materialAssets.clientUploadId],
    })
    .returning();

  if (inserted[0]) {
    return { kind: "acquired", material: rowToMaterial(inserted[0]) };
  }

  const [existing] = await db
    .select()
    .from(materialAssets)
    .where(
      and(
        eq(materialAssets.userId, input.userId),
        eq(materialAssets.clientUploadId, input.clientUploadId),
      ),
    )
    .limit(1);

  if (!existing) {
    // Extremely unlikely: conflict with empty RETURNING but row vanished.
    const [retry] = await db.insert(materialAssets).values(values).returning();
    return { kind: "acquired", material: rowToMaterial(retry) };
  }

  if (existing.status === "digesting" && isDigestOrphan(existing.createdAt, input.now)) {
    const orphanCutoff = new Date(input.now.getTime() - MATERIAL_DIGEST_ORPHAN_MS).toISOString();
    const reclaimed = await db
      .update(materialAssets)
      .set({
        createdAt,
        digestedTextRef: "",
        tokenCount: null,
        processingReport: [],
        originalFilename: input.originalFilename ?? existing.originalFilename,
        digestionPipelineVersion: input.digestionPipelineVersion,
        subjectId: input.subjectId,
        status: "digesting",
      })
      .where(
        and(
          eq(materialAssets.id, existing.id),
          eq(materialAssets.status, "digesting"),
          lt(materialAssets.createdAt, orphanCutoff),
        ),
      )
      .returning();

    if (reclaimed[0]) {
      return { kind: "acquired", material: rowToMaterial(reclaimed[0]) };
    }

    // Lost the reclaim race — treat as duplicate of whatever won.
    const [again] = await db
      .select()
      .from(materialAssets)
      .where(eq(materialAssets.id, existing.id))
      .limit(1);
    return { kind: "duplicate", material: rowToMaterial(again ?? existing) };
  }

  return { kind: "duplicate", material: rowToMaterial(existing) };
}

export function isDigestOrphan(createdAtIso: string, now: Date, orphanMs: number = MATERIAL_DIGEST_ORPHAN_MS): boolean {
  const createdMs = Date.parse(createdAtIso);
  if (!Number.isFinite(createdMs)) return true;
  return now.getTime() - createdMs > orphanMs;
}

export interface CompleteMaterialDigestInput {
  digestedText: string;
  status: Exclude<MaterialDigestionStatus, "pending" | "digesting">;
  processingReport: MaterialProcessingEntry[];
  digestionPipelineVersion?: string;
}

/** Flip a digesting row to its terminal status once the pipeline finishes. */
export async function completeMaterialDigest(
  db: Db,
  userId: string,
  materialId: string,
  input: CompleteMaterialDigestInput,
): Promise<MaterialAsset | null> {
  const patch: Partial<typeof materialAssets.$inferInsert> = {
    status: input.status,
    digestedTextRef: input.digestedText,
    tokenCount:
      input.status === "ready" || input.status === "partial"
        ? Math.ceil(input.digestedText.length / 4)
        : null,
    processingReport: input.processingReport,
  };
  if (input.digestionPipelineVersion) {
    patch.digestionPipelineVersion = input.digestionPipelineVersion;
  }

  const [row] = await db
    .update(materialAssets)
    .set(patch)
    .where(and(eq(materialAssets.id, materialId), eq(materialAssets.userId, userId)))
    .returning();
  return row ? rowToMaterial(row) : null;
}

/** Mark a claimed digest as failed (quota/safety/pipeline error after claim). */
export async function failMaterialDigest(
  db: Db,
  userId: string,
  materialId: string,
): Promise<MaterialAsset | null> {
  return completeMaterialDigest(db, userId, materialId, {
    digestedText: "",
    status: "failed",
    processingReport: [],
  });
}

/**
 * Lazily flip zombie `digesting` rows to `failed` so list/get never leave
 * the student on an eternal "procesando". Idempotent.
 */
export async function failStaleDigestingMaterials(
  db: Db,
  userId: string,
  subjectId: string,
  now: Date,
): Promise<number> {
  const orphanCutoff = new Date(now.getTime() - MATERIAL_DIGEST_ORPHAN_MS).toISOString();
  const updated = await db
    .update(materialAssets)
    .set({ status: "failed" })
    .where(
      and(
        eq(materialAssets.userId, userId),
        eq(materialAssets.subjectId, subjectId),
        eq(materialAssets.status, "digesting"),
        lt(materialAssets.createdAt, orphanCutoff),
        isNull(materialAssets.removedAt),
      ),
    )
    .returning({ id: materialAssets.id });
  return updated.length;
}

export async function findMaterialById(db: Db, userId: string, id: string): Promise<MaterialAsset | null> {
  const [row] = await db
    .select()
    .from(materialAssets)
    .where(and(eq(materialAssets.id, id), eq(materialAssets.userId, userId)))
    .limit(1);
  return row ? rowToMaterial(row) : null;
}

export async function listMaterialsByUser(db: Db, userId: string): Promise<MaterialAsset[]> {
  const rows = await db.select().from(materialAssets).where(eq(materialAssets.userId, userId));
  return rows.map(rowToMaterial);
}

/**
 * Subject-scoped list for the owning user only.
 * `userId` is mandatory in the WHERE (not just subjectId) so a caller who
 * already passed an ownership check still cannot leak rows if that check
 * is ever bypassed — isolation is enforced at the repository boundary.
 * Soft-deleted rows (`removedAt`) are omitted: they are not recoverable
 * study material for the student-facing reconcile path.
 *
 * Also flips stale `digesting` zombies to `failed` before returning so the
 * client can distinguish "sigue trabajando" from "esto murió".
 */
export async function listMaterialsBySubject(
  db: Db,
  userId: string,
  subjectId: string,
  now: Date = new Date(),
): Promise<MaterialAsset[]> {
  await failStaleDigestingMaterials(db, userId, subjectId, now);
  const rows = await db
    .select()
    .from(materialAssets)
    .where(
      and(
        eq(materialAssets.userId, userId),
        eq(materialAssets.subjectId, subjectId),
        isNull(materialAssets.removedAt),
      ),
    );
  return rows.map(rowToMaterial);
}

export async function findMaterialsByIds(db: Db, userId: string, ids: string[]): Promise<MaterialAsset[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(materialAssets).where(eq(materialAssets.userId, userId));
  const idSet = new Set(ids);
  return rows.filter((r) => idSet.has(r.id)).map(rowToMaterial);
}

/** Test/helper: force-set createdAt (orphan reclaim / stale tests). */
export async function setMaterialCreatedAtForTests(
  db: Db,
  materialId: string,
  createdAt: string,
): Promise<void> {
  await db.update(materialAssets).set({ createdAt }).where(eq(materialAssets.id, materialId));
}
