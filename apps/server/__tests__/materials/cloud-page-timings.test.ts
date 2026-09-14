/**
 * Cloud-page timing instrumentation — processingReport must carry
 * raster/model/safety/total ms, and a cached entry must not inherit
 * another run's timings. Zero paid API calls (fakes only).
 */
import { describe, expect, it, vi } from "vitest";
import type { IngestAdapter } from "@buxo/models/execution/ingest";
import { cloudPageProcessingEntry } from "../../src/materials/cloud-page-report";
import { transcribeCloudPage, type DigestMaterialPdfDeps } from "../../src/materials/pipeline";
import type { RasterizerService } from "../../src/raster/rasterizer";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeIngestAdapter(text: string, delayMs: number): IngestAdapter {
  return {
    transcribeImage: async () => {
      await sleep(delayMs);
      return { text, servedBy: { providerId: "fake", modelId: "vision-ocr" }, promptVersion: "fake-v1" };
    },
  };
}

function fakeDeps(modelDelayMs: number): DigestMaterialPdfDeps {
  return {
    models: {
      createIngestAdapter: () => fakeIngestAdapter("fake page text", modelDelayMs),
    },
    safetyClassifier: {
      classify: async () => {
        await sleep(15);
        return {
          category: "none" as const,
          confidence: 1,
          providerId: "test",
          modelId: "test",
        };
      },
    },
    checkIngestQuota: async () => ({ ok: true as const }),
    recordIngestUsage: async () => {},
  };
}

function fakeRasterizer(delayMs: number): RasterizerService {
  return {
    rasterizePage: async () => {
      await sleep(delayMs);
      return { png: Buffer.from([0x89, 0x50, 0x4e, 0x47]), width: 100, height: 100, scale: 1 };
    },
  };
}

describe("cloud-page timings in processingReport", () => {
  it("reports measured raster/model/safety/total ms for a fresh cloud page", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const outcome = await transcribeCloudPage(
        new Uint8Array([1, 2, 3]),
        1,
        1,
        "Matemática",
        fakeDeps(40),
        fakeRasterizer(30),
      );
      expect(outcome.failed).toBe(false);
      expect(outcome.cached).toBe(false);
      expect(outcome.timings.rasterMs).toBeGreaterThanOrEqual(25);
      expect(outcome.timings.modelMs).toBeGreaterThanOrEqual(35);
      expect(outcome.timings.safetyMs).toBeGreaterThanOrEqual(10);
      expect(outcome.timings.totalMs).toBeGreaterThanOrEqual(
        outcome.timings.rasterMs + outcome.timings.modelMs + outcome.timings.safetyMs,
      );

      const entry = cloudPageProcessingEntry(1, outcome);
      expect(entry).toMatchObject({
        page: 1,
        route: "cloud-page",
        cached: false,
        rasterMs: outcome.timings.rasterMs,
        modelMs: outcome.timings.modelMs,
        safetyMs: outcome.timings.safetyMs,
        totalMs: outcome.timings.totalMs,
      });

      const timingLog = info.mock.calls
        .map((c) => {
          try {
            return JSON.parse(String(c[0])) as { msg?: string };
          } catch {
            return null;
          }
        })
        .find((row) => row?.msg === "material.cloud_page_timing");
      expect(timingLog).toMatchObject({
        msg: "material.cloud_page_timing",
        page: 1,
        cached: false,
        rasterMs: outcome.timings.rasterMs,
        modelMs: outcome.timings.modelMs,
        safetyMs: outcome.timings.safetyMs,
        totalMs: outcome.timings.totalMs,
      });
    } finally {
      info.mockRestore();
    }
  });

  it("cached entry reports zero timings — does not inherit another run's numbers", () => {
    const entry = cloudPageProcessingEntry(2, {
      text: "from cache",
      costUsd: 0,
      failed: false,
      cached: true,
      // Deliberately huge — the helper MUST zero these, not pass them through.
      timings: { rasterMs: 999_000, modelMs: 888_000, safetyMs: 777_000, totalMs: 2_664_000 },
    });
    expect(entry.cached).toBe(true);
    expect(entry.rasterMs).toBe(0);
    expect(entry.modelMs).toBe(0);
    expect(entry.safetyMs).toBe(0);
    expect(entry.totalMs).toBe(0);
    expect(entry.costUsd).toBe(0);
  });
});
