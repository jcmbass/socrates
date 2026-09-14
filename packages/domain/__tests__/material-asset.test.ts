import { describe, expect, it } from "vitest";
import {
  MaterialAssetSchema,
  MaterialProcessingEntrySchema,
  MaterialStorageRefSchema,
  type MaterialAsset,
} from "../material-asset";

function makeMaterialAsset(overrides: Partial<MaterialAsset> = {}): MaterialAsset {
  return {
    id: "material-1",
    userId: "user-1",
    subjectId: "subject-1",
    kind: "pdf",
    originalFilename: "guia1.pdf",
    createdAt: "2026-07-10T10:00:00.000Z",
    status: "ready",
    storage: { location: "device_only", blobRef: null },
    digestedTextRef: "sha256:abcd",
    tokenCount: 1200,
    truncated: false,
    droppedTokens: 0,
    processingReport: [{ page: 1, route: "local", costUsd: 0, cached: false }],
    digestionPipelineVersion: "tiered-v1",
    removedAt: null,
    schemaVersion: 1,
    ...overrides,
  };
}

describe("MaterialAssetSchema", () => {
  it("accepts a well-formed ready device_only PDF asset", () => {
    expect(MaterialAssetSchema.safeParse(makeMaterialAsset()).success).toBe(true);
  });

  it("accepts a cloud_blob asset with a blobRef", () => {
    const result = MaterialAssetSchema.safeParse(
      makeMaterialAsset({ storage: { location: "cloud_blob", blobRef: "s3://bucket/key" } }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a partial-status asset (some pages failed, rest usable)", () => {
    expect(MaterialAssetSchema.safeParse(makeMaterialAsset({ status: "partial" })).success).toBe(true);
  });

  it("accepts a paste kind with no page numbers", () => {
    const result = MaterialAssetSchema.safeParse(
      makeMaterialAsset({
        kind: "paste",
        originalFilename: null,
        processingReport: [{ page: null, route: "local", costUsd: 0, cached: false }],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an invalid digestion status", () => {
    expect(MaterialAssetSchema.safeParse(makeMaterialAsset({ status: "uploaded" as never })).success).toBe(false);
  });

  it("rejects a negative droppedTokens", () => {
    expect(MaterialAssetSchema.safeParse(makeMaterialAsset({ droppedTokens: -1 })).success).toBe(false);
  });
});

describe("MaterialStorageRefSchema", () => {
  it("rejects an unknown location", () => {
    const result = MaterialStorageRefSchema.safeParse({ location: "s3", blobRef: "x" });
    expect(result.success).toBe(false);
  });
});

describe("MaterialProcessingEntrySchema", () => {
  it("rejects a negative costUsd", () => {
    const result = MaterialProcessingEntrySchema.safeParse({ page: 1, route: "local", costUsd: -0.1, cached: false });
    expect(result.success).toBe(false);
  });

  it("accepts every processing route", () => {
    for (const route of ["local", "cloud-figure", "cloud-page"] as const) {
      const result = MaterialProcessingEntrySchema.safeParse({ page: 1, route, costUsd: 0, cached: true });
      expect(result.success).toBe(true);
    }
  });

  it("accepts optional per-page timings (additive; absent remains valid)", () => {
    expect(MaterialProcessingEntrySchema.safeParse({ page: 1, route: "local", costUsd: 0, cached: false }).success).toBe(true);
    expect(
      MaterialProcessingEntrySchema.safeParse({
        page: 1,
        route: "cloud-page",
        costUsd: 0.001,
        cached: false,
        rasterMs: 120,
        modelMs: 15000,
        safetyMs: 5,
        totalMs: 15130,
      }).success,
    ).toBe(true);
    expect(
      MaterialProcessingEntrySchema.safeParse({
        page: 1,
        route: "cloud-page",
        costUsd: 0,
        cached: true,
        rasterMs: 0,
        modelMs: 0,
        safetyMs: 0,
        totalMs: 0,
      }).success,
    ).toBe(true);
  });
});
