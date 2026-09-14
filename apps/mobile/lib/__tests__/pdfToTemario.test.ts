import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/errors";
import type { Fuente, MaterialAsset, Temario } from "../api/types";
import { attachFuenteFromIngestResult } from "../ingestToFuente";
import type { IngestResult } from "../materialIngestBridge";
import {
  buildTemarioFromIngestResult,
  retryGenerateTemarioFromFuente,
} from "../pdfToTemario";

function ingestResult(overrides: Partial<IngestResult> = {}): IngestResult {
  return {
    fileName: "programa.pdf",
    totalPages: 1,
    manifest: [{ pageNumber: 1, claimedTier: "local", localText: "Unidad 1: átomos" }],
    cloudPages: [],
    ...overrides,
  };
}

function material(text = "texto extraído del PDF"): MaterialAsset {
  return {
    id: "mat-1",
    userId: "user-1",
    subjectId: "subject-1",
    kind: "pdf",
    originalFilename: "programa.pdf",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "ready",
    storage: { location: "device_only", blobRef: null },
    digestedTextRef: text,
    tokenCount: null,
    truncated: false,
    droppedTokens: 0,
    processingReport: [],
    digestionPipelineVersion: "test",
    removedAt: null,
    schemaVersion: 1,
  };
}

function fuente(overrides: Partial<Fuente> = {}): Fuente {
  return {
    id: "fuente-1",
    subjectId: "subject-1",
    userId: "user-1",
    name: "programa.pdf",
    kind: "pdf",
    text: "texto extraído del PDF",
    createdAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

function temario(): Temario {
  return {
    id: "temario-1",
    subjectId: "subject-1",
    userId: "user-1",
    topics: [
      {
        id: "t1",
        temarioId: "temario-1",
        order: 0,
        title: "Átomos",
        status: "new",
        stars: 0,
        recommended: true,
        unitLabel: null,
        schemaVersion: 1,
      },
    ],
    milestones: [],
    generatedBy: "ai",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 1,
  };
}

describe("attachFuenteFromIngestResult", () => {
  it("uploads then attachSource with extracted text only", async () => {
    const uploadMaterialSubset = vi.fn().mockResolvedValue(material("hola mundo"));
    const attachSource = vi.fn().mockResolvedValue(fuente({ text: "hola mundo" }));

    const result = await attachFuenteFromIngestResult(
      { uploadMaterialSubset, attachSource },
      "tok",
      "subject-1",
      ingestResult(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(uploadMaterialSubset).toHaveBeenCalledOnce();
    expect(attachSource).toHaveBeenCalledWith("tok", "subject-1", {
      name: "programa.pdf",
      kind: "pdf",
      text: "hola mundo",
    });
    expect(result.fuente.id).toBe("fuente-1");
  });

  it("propagates quota errors from upload and does not call attachSource", async () => {
    const uploadMaterialSubset = vi.fn().mockRejectedValue(new ApiError("quota_exceeded", "quota", 429));
    const attachSource = vi.fn();

    const result = await attachFuenteFromIngestResult(
      { uploadMaterialSubset, attachSource },
      "tok",
      "subject-1",
      ingestResult(),
    );

    expect(result).toEqual({ ok: false, kind: "quota", message: "quota" });
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("rejects over-cap page counts before calling upload (beta-real 07 B.2)", async () => {
    const uploadMaterialSubset = vi.fn();
    const attachSource = vi.fn();
    const result = await attachFuenteFromIngestResult(
      { uploadMaterialSubset, attachSource },
      "tok",
      "subject-1",
      ingestResult({ totalPages: 25 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("too_many_pages");
    expect(uploadMaterialSubset).not.toHaveBeenCalled();
  });

  it("propagates network errors from attachSource", async () => {
    const uploadMaterialSubset = vi.fn().mockResolvedValue(material());
    const attachSource = vi.fn().mockRejectedValue(new ApiError("network_error", "offline", null));

    const result = await attachFuenteFromIngestResult(
      { uploadMaterialSubset, attachSource },
      "tok",
      "subject-1",
      ingestResult(),
    );

    expect(result).toEqual({ ok: false, kind: "network", message: "offline" });
  });
});

describe("buildTemarioFromIngestResult", () => {
  it("chains upload → attachSource → generateTemario with progress stages", async () => {
    const stages: string[] = [];
    const uploadMaterialSubset = vi.fn().mockResolvedValue(material());
    const attachSource = vi.fn().mockResolvedValue(fuente());
    const generateTemario = vi.fn().mockResolvedValue({
      temario: temario(),
      generatedBy: "ai",
      result: { text: "ok", servedBy: { providerId: "fake", modelId: "fake" }, promptVersion: "v1" },
    });

    const result = await buildTemarioFromIngestResult(
      { uploadMaterialSubset, attachSource, generateTemario },
      "tok",
      "subject-1",
      ingestResult(),
      (stage) => stages.push(stage),
    );

    expect(stages).toEqual(["reading", "building"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generateTemario).toHaveBeenCalledWith("tok", "subject-1", "fuente-1");
    expect(result.temario.topics).toHaveLength(1);
  });

  it("does NOT call generateTemario when attachSource fails", async () => {
    const uploadMaterialSubset = vi.fn().mockResolvedValue(material());
    const attachSource = vi.fn().mockRejectedValue(new ApiError("invalid_request", "bad pdf", 400));
    const generateTemario = vi.fn();

    const result = await buildTemarioFromIngestResult(
      { uploadMaterialSubset, attachSource, generateTemario },
      "tok",
      "subject-1",
      ingestResult(),
    );

    expect(generateTemario).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, kind: "invalid_pdf", fuenteId: null, fuente: null });
  });

  it("keeps the Fuente when generateTemario fails (500) so the student can retry", async () => {
    const saved = fuente();
    const uploadMaterialSubset = vi.fn().mockResolvedValue(material());
    const attachSource = vi.fn().mockResolvedValue(saved);
    const generateTemario = vi.fn().mockRejectedValue(new ApiError("internal_error", "builder blew up", 500));

    const result = await buildTemarioFromIngestResult(
      { uploadMaterialSubset, attachSource, generateTemario },
      "tok",
      "subject-1",
      ingestResult(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("generate_failed");
    expect(result.fuenteId).toBe("fuente-1");
    expect(result.fuente).toEqual(saved);
  });

  it("propagates network errors during generate with fuenteId preserved", async () => {
    const saved = fuente();
    const uploadMaterialSubset = vi.fn().mockResolvedValue(material());
    const attachSource = vi.fn().mockResolvedValue(saved);
    const generateTemario = vi.fn().mockRejectedValue(new ApiError("network_error", "drop", null));

    const result = await buildTemarioFromIngestResult(
      { uploadMaterialSubset, attachSource, generateTemario },
      "tok",
      "subject-1",
      ingestResult(),
    );

    expect(result).toMatchObject({ ok: false, kind: "network", fuenteId: "fuente-1" });
  });
});

describe("retryGenerateTemarioFromFuente", () => {
  it("retries generate without upload/attach", async () => {
    const generateTemario = vi.fn().mockResolvedValue({
      temario: temario(),
      generatedBy: "ai",
      result: { text: "ok", servedBy: { providerId: "fake", modelId: "fake" }, promptVersion: "v1" },
    });
    const saved = fuente();

    const result = await retryGenerateTemarioFromFuente({ generateTemario }, "tok", "subject-1", saved);

    expect(generateTemario).toHaveBeenCalledWith("tok", "subject-1", "fuente-1");
    expect(result.ok).toBe(true);
  });
});
