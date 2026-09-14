/**
 * Orphan-material reconcile — pure selection + attach-only recovery.
 * Covers digesting (in-flight) vs ready (attach) vs failed.
 * Mutate-to-fail covers caducidad and idempotency guards.
 */
import { describe, expect, it, vi } from "vitest";
import type { Fuente, MaterialAsset } from "../api/types";
import {
  ORPHAN_MATERIAL_MAX_AGE_MS,
  classifyMaterialsForReconcile,
  fuenteCoversMaterial,
  isMaterialDigestFailed,
  isMaterialDigesting,
  isMaterialEligibleForReconcile,
  reconcileOrphanMaterials,
  selectOrphanMaterials,
  type ReconcileMaterialsClient,
} from "../reconcileOrphanMaterials";

const NOW = Date.parse("2026-08-02T18:00:00.000Z");

function material(overrides: Partial<MaterialAsset> = {}): MaterialAsset {
  return {
    id: "mat-1",
    userId: "u1",
    subjectId: "subj1",
    kind: "pdf",
    originalFilename: "guiaVA3.pdf",
    createdAt: new Date(NOW - 60_000).toISOString(),
    status: "ready",
    storage: { location: "cloud_blob", blobRef: null },
    digestedTextRef: "texto digerido de la guía",
    tokenCount: 10,
    truncated: false,
    droppedTokens: 0,
    processingReport: [],
    digestionPipelineVersion: "f2-wq1-server-raster-v1",
    removedAt: null,
    schemaVersion: 1,
    ...overrides,
  };
}

function fuente(overrides: Partial<Fuente> = {}): Fuente {
  return {
    id: "f1",
    subjectId: "subj1",
    userId: "u1",
    name: "guiaVA3.pdf",
    kind: "pdf",
    text: "texto digerido de la guía",
    createdAt: new Date(NOW).toISOString(),
    schemaVersion: 1,
    ...overrides,
  };
}

describe("isMaterialEligibleForReconcile", () => {
  it("accepts a recent ready pdf with text", () => {
    expect(isMaterialEligibleForReconcile(material(), NOW)).toBe(true);
  });

  it("accepts partial status (usable digest)", () => {
    expect(isMaterialEligibleForReconcile(material({ status: "partial" }), NOW)).toBe(true);
  });

  it("rejects pending / failed / digesting / empty text / non-pdf / soft-deleted", () => {
    expect(isMaterialEligibleForReconcile(material({ status: "pending" }), NOW)).toBe(false);
    expect(isMaterialEligibleForReconcile(material({ status: "failed" }), NOW)).toBe(false);
    expect(isMaterialEligibleForReconcile(material({ status: "digesting" }), NOW)).toBe(false);
    expect(isMaterialEligibleForReconcile(material({ digestedTextRef: "" }), NOW)).toBe(false);
    expect(isMaterialEligibleForReconcile(material({ kind: "paste" }), NOW)).toBe(false);
    expect(isMaterialEligibleForReconcile(material({ removedAt: new Date(NOW).toISOString() }), NOW)).toBe(false);
  });

  it("rejects materials older than the recovery window (caducidad)", () => {
    const old = material({
      createdAt: new Date(NOW - ORPHAN_MATERIAL_MAX_AGE_MS - 1).toISOString(),
    });
    expect(isMaterialEligibleForReconcile(old, NOW)).toBe(false);
    // Boundary: exactly at max age still eligible.
    const edge = material({
      createdAt: new Date(NOW - ORPHAN_MATERIAL_MAX_AGE_MS).toISOString(),
    });
    expect(isMaterialEligibleForReconcile(edge, NOW)).toBe(true);
  });
});

describe("digesting / failed classification", () => {
  it("isMaterialDigesting only for pdf digesting rows", () => {
    expect(isMaterialDigesting(material({ status: "digesting", digestedTextRef: "" }))).toBe(true);
    expect(isMaterialDigesting(material({ status: "ready" }))).toBe(false);
    expect(isMaterialDigesting(material({ status: "digesting", kind: "paste" }))).toBe(false);
  });

  it("isMaterialDigestFailed only for recent failed pdfs", () => {
    expect(isMaterialDigestFailed(material({ status: "failed", digestedTextRef: "" }), NOW)).toBe(true);
    expect(
      isMaterialDigestFailed(
        material({
          status: "failed",
          createdAt: new Date(NOW - ORPHAN_MATERIAL_MAX_AGE_MS - 1).toISOString(),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("classifyMaterialsForReconcile prefers digesting over attachable", () => {
    const classified = classifyMaterialsForReconcile(
      [
        material({ id: "ready", status: "ready" }),
        material({ id: "dig", status: "digesting", digestedTextRef: "" }),
      ],
      [],
      NOW,
    );
    expect(classified.digesting.map((m) => m.id)).toEqual(["dig"]);
    expect(classified.attachable.map((m) => m.id)).toEqual(["ready"]);
  });
});

describe("selectOrphanMaterials", () => {
  it("returns materials with no covering Fuente", () => {
    const orphans = selectOrphanMaterials([material()], [], NOW);
    expect(orphans).toHaveLength(1);
  });

  it("skips materials already covered by text-identical Fuente (idempotency)", () => {
    const orphans = selectOrphanMaterials([material()], [fuente()], NOW);
    expect(orphans).toHaveLength(0);
  });

  it("does not treat same filename + different text as covered", () => {
    const orphans = selectOrphanMaterials(
      [material()],
      [fuente({ text: "otro contenido" })],
      NOW,
    );
    expect(orphans).toHaveLength(1);
  });

  it("fuenteCoversMaterial matches on digested text only", () => {
    expect(fuenteCoversMaterial(fuente({ name: "otro.pdf" }), material())).toBe(true);
    expect(fuenteCoversMaterial(fuente({ text: "x" }), material())).toBe(false);
  });
});

describe("reconcileOrphanMaterials", () => {
  it("attaches orphans via attachSource and never uploads", async () => {
    const mat = material();
    const attachSource = vi.fn().mockResolvedValue(fuente({ id: "f-new" }));
    const client: ReconcileMaterialsClient = {
      listMaterialsBySubject: vi.fn().mockResolvedValue([mat]),
      listFuentes: vi.fn().mockResolvedValue([]),
      attachSource,
    };

    const result = await reconcileOrphanMaterials(client, "tok", "subj1", { nowMs: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attached).toHaveLength(1);
    expect(result.digesting).toHaveLength(0);
    expect(attachSource).toHaveBeenCalledTimes(1);
    expect(attachSource).toHaveBeenCalledWith("tok", "subj1", {
      name: "guiaVA3.pdf",
      kind: "pdf",
      text: mat.digestedTextRef,
    });
    expect(Object.keys(client)).not.toContain("uploadMaterialFull");
  });

  it("reports digesting without attaching or uploading", async () => {
    const dig = material({ status: "digesting", digestedTextRef: "" });
    const onDigesting = vi.fn();
    const attachSource = vi.fn();
    const client: ReconcileMaterialsClient = {
      listMaterialsBySubject: vi.fn().mockResolvedValue([dig]),
      listFuentes: vi.fn().mockResolvedValue([]),
      attachSource,
    };

    const result = await reconcileOrphanMaterials(client, "tok", "subj1", {
      nowMs: NOW,
      onDigesting,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digesting).toHaveLength(1);
    expect(result.attached).toHaveLength(0);
    expect(onDigesting).toHaveBeenCalledOnce();
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("reports failed without attaching", async () => {
    const failed = material({ status: "failed", digestedTextRef: "" });
    const onFailed = vi.fn();
    const attachSource = vi.fn();
    const client: ReconcileMaterialsClient = {
      listMaterialsBySubject: vi.fn().mockResolvedValue([failed]),
      listFuentes: vi.fn().mockResolvedValue([]),
      attachSource,
    };

    const result = await reconcileOrphanMaterials(client, "tok", "subj1", {
      nowMs: NOW,
      onFailed,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.failed).toHaveLength(1);
    expect(onFailed).toHaveBeenCalledOnce();
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("is idempotent: second pass attaches nothing when Fuente already covers", async () => {
    const mat = material();
    const existing = fuente();
    const attachSource = vi.fn();
    const client: ReconcileMaterialsClient = {
      listMaterialsBySubject: vi.fn().mockResolvedValue([mat]),
      listFuentes: vi.fn().mockResolvedValue([existing]),
      attachSource,
    };

    const first = await reconcileOrphanMaterials(client, "tok", "subj1", { nowMs: NOW });
    const second = await reconcileOrphanMaterials(client, "tok", "subj1", { nowMs: NOW });
    expect(first).toMatchObject({ ok: true, attached: [], skipped: 1 });
    expect(second).toMatchObject({ ok: true, attached: [], skipped: 1 });
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("in-process double orphan with same text attaches once", async () => {
    const digest = "mismo texto";
    const a = material({ id: "m1", digestedTextRef: digest });
    const b = material({ id: "m2", digestedTextRef: digest, originalFilename: "copia.pdf" });
    const attachSource = vi.fn().mockImplementation(async (_t, _s, input) =>
      fuente({ id: `f-${attachSource.mock.calls.length}`, name: input.name, text: input.text }),
    );
    const client: ReconcileMaterialsClient = {
      listMaterialsBySubject: vi.fn().mockResolvedValue([a, b]),
      listFuentes: vi.fn().mockResolvedValue([]),
      attachSource,
    };

    const result = await reconcileOrphanMaterials(client, "tok", "subj1", { nowMs: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(attachSource).toHaveBeenCalledTimes(1);
    expect(result.attached).toHaveLength(1);
  });

  it("does nothing noisy when there is nothing to reconcile", async () => {
    const onAttachStart = vi.fn();
    const client: ReconcileMaterialsClient = {
      listMaterialsBySubject: vi.fn().mockResolvedValue([]),
      listFuentes: vi.fn().mockResolvedValue([]),
      attachSource: vi.fn(),
    };
    const result = await reconcileOrphanMaterials(client, "tok", "subj1", {
      nowMs: NOW,
      onAttachStart,
    });
    expect(result).toMatchObject({ ok: true, attached: [], skipped: 0, digesting: [], failed: [] });
    expect(onAttachStart).not.toHaveBeenCalled();
  });

  it("does not attach expired orphans", async () => {
    const old = material({
      createdAt: new Date(NOW - ORPHAN_MATERIAL_MAX_AGE_MS - 60_000).toISOString(),
    });
    const attachSource = vi.fn();
    const client: ReconcileMaterialsClient = {
      listMaterialsBySubject: vi.fn().mockResolvedValue([old]),
      listFuentes: vi.fn().mockResolvedValue([]),
      attachSource,
    };
    const result = await reconcileOrphanMaterials(client, "tok", "subj1", { nowMs: NOW });
    expect(result).toMatchObject({ ok: true, attached: [], skipped: 1 });
    expect(attachSource).not.toHaveBeenCalled();
  });
});
