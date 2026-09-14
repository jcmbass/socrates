/**
 * Adaptive raster scale — beta-real 07.
 *
 * `escalaObjetivo = sqrt(TARGET / (w×h))`
 * `escalaMaxima   = sqrt(MAX / (w×h))`
 * then apply DPI floor, never exceeding the hard pixel cap.
 *
 * Pure (no pdf.js / canvas) so carta / 16:9 / A4 / absurd cases are
 * offline-testable without loading a PDF.
 */
import {
  MAX_PIXELS_PER_PAGE,
  MIN_RASTER_DPI,
  PDF_POINTS_PER_INCH,
  TARGET_PIXELS_PER_PAGE,
} from "./limits";

export type AdaptiveScaleInput = {
  /** Page width in PDF user-space points (at scale 1). */
  widthPt: number;
  /** Page height in PDF user-space points (at scale 1). */
  heightPt: number;
  /**
   * Optional caller-requested scale. When set, it is clamped down to the
   * hard pixel ceiling (never rejected solely for being "too high" —
   * absurd pages that overflow even at scale 1 still throw upstream).
   */
  requestedScale?: number;
};

export type AdaptiveScaleResult = {
  scale: number;
  widthPx: number;
  heightPx: number;
  pixels: number;
  /** True when the DPI floor raised the scale above the pixel-budget target. */
  dpiFloorApplied: boolean;
  /** True when the hard pixel ceiling lowered the scale. */
  pixelCapApplied: boolean;
};

/** Scale corresponding to `MIN_RASTER_DPI` (points are 1/72"). */
export function minScaleForDpiFloor(minDpi: number = MIN_RASTER_DPI): number {
  return minDpi / PDF_POINTS_PER_INCH;
}

/**
 * Returns false when even scale=1 would exceed `MAX_PIXELS_PER_PAGE`
 * (the only case that still deserves `RasterPageTooLargeError`).
 */
export function pageFitsAtScaleOne(widthPt: number, heightPt: number, maxPixels: number = MAX_PIXELS_PER_PAGE): boolean {
  if (!(widthPt > 0) || !(heightPt > 0)) return false;
  return Math.ceil(widthPt) * Math.ceil(heightPt) <= maxPixels;
}

/**
 * Largest scale where `ceil(w×s) * ceil(h×s) ≤ maxPixels`.
 * Binary search accounts for Math.ceil used by pdf.js viewport rounding.
 */
export function maxScaleFittingPixels(widthPt: number, heightPt: number, maxPixels: number = MAX_PIXELS_PER_PAGE): number {
  if (Math.ceil(widthPt) * Math.ceil(heightPt) > maxPixels) return 0;
  let lo = 0;
  let hi = Math.sqrt(maxPixels / (widthPt * heightPt)) + 1;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const pixels = Math.ceil(widthPt * mid) * Math.ceil(heightPt * mid);
    if (pixels <= maxPixels) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function computeAdaptiveScale(input: AdaptiveScaleInput): AdaptiveScaleResult {
  const { widthPt, heightPt } = input;
  if (!(widthPt > 0) || !(heightPt > 0)) {
    throw new Error(`computeAdaptiveScale: invalid page size ${widthPt}×${heightPt}`);
  }

  const area = widthPt * heightPt;
  const maxScale = maxScaleFittingPixels(widthPt, heightPt);
  const targetScale = Math.sqrt(TARGET_PIXELS_PER_PAGE / area);
  const minScale = minScaleForDpiFloor();

  let scale: number;
  let dpiFloorApplied = false;
  let pixelCapApplied = false;

  if (input.requestedScale !== undefined) {
    scale = input.requestedScale;
    if (scale > maxScale) {
      scale = maxScale;
      pixelCapApplied = true;
    }
  } else {
    scale = Math.min(targetScale, maxScale);
    if (targetScale > maxScale) pixelCapApplied = true;
    if (scale < minScale) {
      const floored = Math.min(minScale, maxScale);
      if (floored > scale + 1e-12) dpiFloorApplied = true;
      scale = floored;
      if (minScale > maxScale) pixelCapApplied = true;
    }
  }

  const widthPx = Math.ceil(widthPt * scale);
  const heightPx = Math.ceil(heightPt * scale);
  const pixels = widthPx * heightPx;

  return { scale, widthPx, heightPx, pixels, dpiFloorApplied, pixelCapApplied };
}
