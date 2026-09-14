/**
 * Cloud-page processing report helpers — shared by `pipeline.ts` and
 * `toc-digest.ts` without creating a circular import between those two.
 */
import type { MaterialProcessingEntry } from "@buxo/domain/material-asset";

/** Wall-clock sub-step timings (ms) for one cloud-page pass — measured with `Date.now()`. */
export interface CloudPageTimings {
  rasterMs: number;
  modelMs: number;
  safetyMs: number;
  totalMs: number;
}

/** One outcome of rasterizing+transcribing+safety-checking a single cloud-tier page. costUsd null = costo no medible. */
export interface CloudPageOutcome {
  text: string;
  costUsd: number | null;
  failed: boolean;
  /**
   * True when this page was served from a transcription cache (harness
   * semantics). Server path today always produces `false`; when true,
   * `cloudPageProcessingEntry` zeros timings so a cached hit never inherits
   * another run's measurements.
   */
  cached: boolean;
  timings: CloudPageTimings;
}

/**
 * Builds a `MaterialProcessingEntry` for a cloud-page outcome.
 * Cached hits MUST report timings as 0 (not another run's numbers).
 */
export function cloudPageProcessingEntry(page: number, outcome: CloudPageOutcome): MaterialProcessingEntry {
  if (outcome.cached) {
    return {
      page,
      route: "cloud-page",
      costUsd: outcome.costUsd,
      cached: true,
      rasterMs: 0,
      modelMs: 0,
      safetyMs: 0,
      totalMs: 0,
    };
  }
  return {
    page,
    route: "cloud-page",
    costUsd: outcome.costUsd,
    cached: false,
    rasterMs: outcome.timings.rasterMs,
    modelMs: outcome.timings.modelMs,
    safetyMs: outcome.timings.safetyMs,
    totalMs: outcome.timings.totalMs,
  };
}

export function logCloudPageTiming(page: number, timings: CloudPageTimings, cached: boolean): void {
  // Same shape as raster.adaptive_scale — one JSON line, grep-friendly in Render.
  console.info(
    JSON.stringify({
      msg: "material.cloud_page_timing",
      page,
      rasterMs: timings.rasterMs,
      modelMs: timings.modelMs,
      safetyMs: timings.safetyMs,
      totalMs: timings.totalMs,
      cached,
    }),
  );
}
