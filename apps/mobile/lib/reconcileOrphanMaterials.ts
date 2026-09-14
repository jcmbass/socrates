/**
 * Recover Fuentes / ingest UI when the client died mid-upload.
 *
 * Philosophy (same as `turnReconcile.ts` / `onboardDraft.ts`): the server
 * is the durable record. With `status: "digesting"` rows persisted at
 * claim time, a focus/app-active poll can see PROCESANDO vs TERMINADO —
 * the exact misunderstanding the founder asked us to kill ("pensé que se
 * perdió y el servidor todavía la estaba digiriendo").
 *
 * NEVER re-uploads bytes — only attachSource with already-digested text,
 * or report in-flight / failed status for the pill.
 *
 * Caducidad for attachable orphans: ORPHAN_MATERIAL_MAX_AGE_MS (24h).
 * Stale `digesting` zombies are flipped to `failed` by the server on list
 * (MATERIAL_DIGEST_ORPHAN_MS); the client trusts the status it receives.
 */
import type { ApiClient } from "./api/client";
import type { Fuente, MaterialAsset } from "./api/types";

/**
 * 24h: covers "OS killed the app mid-ingest, student opens Socrates later
 * the same day / next morning". Far shorter than "weeks later I deleted
 * that Fuente on purpose".
 */
export const ORPHAN_MATERIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ReconcileMaterialsClient = Pick<ApiClient, "listMaterialsBySubject" | "listFuentes" | "attachSource">;

/** Fields the selector needs — kept narrow for unit tests. */
export type ReconcileMaterial = Pick<
  MaterialAsset,
  "id" | "kind" | "status" | "originalFilename" | "createdAt" | "digestedTextRef" | "removedAt"
>;

export type ReconcileFuente = Pick<Fuente, "id" | "name" | "text">;

const ATTACHABLE_STATUSES = new Set(["ready", "partial"]);

/**
 * True when this material is a candidate to become a Fuente (digest ok,
 * not soft-deleted, within the recovery window, has text).
 */
export function isMaterialEligibleForReconcile(
  material: ReconcileMaterial,
  nowMs: number,
  maxAgeMs: number = ORPHAN_MATERIAL_MAX_AGE_MS,
): boolean {
  if (material.removedAt != null) return false;
  if (material.kind !== "pdf") return false;
  if (!ATTACHABLE_STATUSES.has(material.status)) return false;
  if (!material.digestedTextRef || material.digestedTextRef.length === 0) return false;
  const createdMs = Date.parse(material.createdAt);
  if (!Number.isFinite(createdMs)) return false;
  if (nowMs - createdMs > maxAgeMs) return false;
  if (nowMs - createdMs < 0) return false;
  return true;
}

/** Fresh `digesting` row — server still working (or just claimed). */
export function isMaterialDigesting(material: ReconcileMaterial): boolean {
  if (material.removedAt != null) return false;
  if (material.kind !== "pdf") return false;
  return material.status === "digesting";
}

/** Terminal failure the student should see (server flipped zombies to failed). */
export function isMaterialDigestFailed(material: ReconcileMaterial, nowMs: number): boolean {
  if (material.removedAt != null) return false;
  if (material.kind !== "pdf") return false;
  if (material.status !== "failed") return false;
  const createdMs = Date.parse(material.createdAt);
  if (!Number.isFinite(createdMs)) return false;
  // Same recovery window as attachable orphans — ancient failures stay quiet.
  if (nowMs - createdMs > ORPHAN_MATERIAL_MAX_AGE_MS) return false;
  return true;
}

/**
 * A Fuente already covers this material when the digested text matches
 * (content identity — what the student paid for). Name alone is not
 * enough: two uploads can share a filename.
 */
export function fuenteCoversMaterial(fuente: ReconcileFuente, material: ReconcileMaterial): boolean {
  return fuente.text === material.digestedTextRef;
}

/**
 * Materials that should get attachSource — eligible + no covering Fuente.
 * Pure; safe to call twice (idempotent selection).
 */
export function selectOrphanMaterials(
  materials: readonly ReconcileMaterial[],
  fuentes: readonly ReconcileFuente[],
  nowMs: number,
  maxAgeMs: number = ORPHAN_MATERIAL_MAX_AGE_MS,
): ReconcileMaterial[] {
  return materials.filter((material) => {
    if (!isMaterialEligibleForReconcile(material, nowMs, maxAgeMs)) return false;
    return !fuentes.some((f) => fuenteCoversMaterial(f, material));
  });
}

export type MaterialReconcileClassification = {
  attachable: ReconcileMaterial[];
  digesting: ReconcileMaterial[];
  failed: ReconcileMaterial[];
};

/** Pure split of list GET into UI actions — no network. */
export function classifyMaterialsForReconcile(
  materials: readonly ReconcileMaterial[],
  fuentes: readonly ReconcileFuente[],
  nowMs: number,
  maxAgeMs: number = ORPHAN_MATERIAL_MAX_AGE_MS,
): MaterialReconcileClassification {
  return {
    attachable: selectOrphanMaterials(materials, fuentes, nowMs, maxAgeMs),
    digesting: materials.filter(isMaterialDigesting),
    failed: materials.filter((m) => isMaterialDigestFailed(m, nowMs)),
  };
}

export type ReconcileOrphanResult =
  | {
      ok: true;
      attached: Fuente[];
      digesting: ReconcileMaterial[];
      failed: ReconcileMaterial[];
      skipped: number;
    }
  | { ok: false; error: unknown };

/**
 * List → classify → attach orphans only (never upload). Re-reads the
 * growing Fuente set in-process so a double call in the same tick cannot
 * create two Fuentes for the same digest.
 */
export async function reconcileOrphanMaterials(
  client: ReconcileMaterialsClient,
  token: string,
  subjectId: string,
  opts?: {
    nowMs?: number;
    maxAgeMs?: number;
    /** Called once per attach about to start (pill / status). */
    onAttachStart?: (fileName: string, materialId: string) => void;
    onAttached?: (fuente: Fuente) => void | Promise<void>;
    /** Server still digesting — drive the same Fuentes pill as a live upload. */
    onDigesting?: (material: ReconcileMaterial) => void;
    /** Recent failed digest — surface once via the pill error path. */
    onFailed?: (material: ReconcileMaterial) => void;
  },
): Promise<ReconcileOrphanResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  const maxAgeMs = opts?.maxAgeMs ?? ORPHAN_MATERIAL_MAX_AGE_MS;

  let materials: MaterialAsset[];
  let fuentes: Fuente[];
  try {
    [materials, fuentes] = await Promise.all([
      client.listMaterialsBySubject(token, subjectId),
      client.listFuentes(token, subjectId),
    ]);
  } catch (error) {
    return { ok: false, error };
  }

  const classified = classifyMaterialsForReconcile(materials, fuentes, nowMs, maxAgeMs);

  // Prefer showing in-flight work over attaching older ready orphans in the
  // same tick — the student who just reopened cares about "¿sigue?".
  if (classified.digesting.length > 0) {
    opts?.onDigesting?.(classified.digesting[0]!);
    return {
      ok: true,
      attached: [],
      digesting: classified.digesting,
      failed: classified.failed,
      skipped: materials.length,
    };
  }

  if (classified.attachable.length === 0) {
    if (classified.failed.length > 0) {
      opts?.onFailed?.(classified.failed[0]!);
    }
    return {
      ok: true,
      attached: [],
      digesting: [],
      failed: classified.failed,
      skipped: materials.length,
    };
  }

  const coveredTexts = new Set(fuentes.map((f) => f.text));
  const attached: Fuente[] = [];

  for (const material of classified.attachable) {
    // In-process idempotency: a prior attach in this loop (or a race that
    // landed between list and now) already covers this digest.
    if (coveredTexts.has(material.digestedTextRef)) continue;

    const fileName = material.originalFilename?.trim() || "PDF";
    opts?.onAttachStart?.(fileName, material.id);

    try {
      const fuente = await client.attachSource(token, subjectId, {
        name: fileName,
        kind: "pdf",
        text: material.digestedTextRef,
      });
      coveredTexts.add(fuente.text);
      attached.push(fuente);
      await opts?.onAttached?.(fuente);
    } catch (error) {
      return { ok: false, error };
    }
  }

  return {
    ok: true,
    attached,
    digesting: [],
    failed: classified.failed,
    skipped: materials.length - attached.length,
  };
}
