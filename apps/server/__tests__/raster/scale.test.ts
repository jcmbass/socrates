/**
 * Adaptive raster scale — pure unit tests (beta-real 07 §5 offline).
 */
import { describe, expect, it } from "vitest";
import {
  MAX_PIXELS_PER_PAGE,
  MIN_RASTER_DPI,
  PDF_POINTS_PER_INCH,
  TARGET_PIXELS_PER_PAGE,
} from "../../src/raster/limits";
import {
  computeAdaptiveScale,
  minScaleForDpiFloor,
  pageFitsAtScaleOne,
} from "../../src/raster/scale";

describe("computeAdaptiveScale", () => {
  it("US Letter (612×792) aims near the pixel budget (~1.2M) above the DPI floor", () => {
    const r = computeAdaptiveScale({ widthPt: 612, heightPt: 792 });
    expect(r.pixels).toBeLessThanOrEqual(MAX_PIXELS_PER_PAGE);
    expect(r.pixels).toBeGreaterThan(TARGET_PIXELS_PER_PAGE * 0.85);
    expect(r.pixels).toBeLessThan(TARGET_PIXELS_PER_PAGE * 1.15);
    expect(r.scale).toBeGreaterThanOrEqual(minScaleForDpiFloor());
    expect(r.dpiFloorApplied).toBe(false);
  });

  it("16:9 slide (1376×768) no longer rejects — fits under the hard cap", () => {
    const r = computeAdaptiveScale({ widthPt: 1376, heightPt: 768 });
    expect(pageFitsAtScaleOne(1376, 768)).toBe(true);
    expect(r.pixels).toBeLessThanOrEqual(MAX_PIXELS_PER_PAGE);
    // Old fixed 2× would be ~4.22M and reject; adaptive must stay under.
    expect(1376 * 2 * (768 * 2)).toBeGreaterThan(MAX_PIXELS_PER_PAGE);
    expect(r.scale).toBeLessThan(2);
    // DPI floor may raise scale above the pure budget target (~1.19).
    expect(r.scale).toBeGreaterThanOrEqual(minScaleForDpiFloor() - 1e-9);
  });

  it("A4 (595.28×841.89) is a reasonable non-rejecting input", () => {
    const r = computeAdaptiveScale({ widthPt: 595.28, heightPt: 841.89 });
    expect(r.pixels).toBeLessThanOrEqual(MAX_PIXELS_PER_PAGE);
    expect(r.scale).toBeGreaterThanOrEqual(minScaleForDpiFloor() - 1e-9);
  });

  it("absurd page that overflows even at scale 1 is the only fit failure", () => {
    expect(pageFitsAtScaleOne(3000, 3000)).toBe(false);
    expect(pageFitsAtScaleOne(612, 792)).toBe(true);
    expect(pageFitsAtScaleOne(1376, 768)).toBe(true);
  });

  it("respects the DPI floor (~110 DPI → scale ≥ minScale) when the cap allows it", () => {
    // Slide-ish: budget alone undershoots the floor; floor still fits under MAX.
    const widthPt = 1376;
    const heightPt = 768;
    const budgetScale = Math.sqrt(TARGET_PIXELS_PER_PAGE / (widthPt * heightPt));
    expect(budgetScale).toBeLessThan(minScaleForDpiFloor());
    const r = computeAdaptiveScale({ widthPt, heightPt });
    expect(r.dpiFloorApplied).toBe(true);
    expect(r.scale).toBeCloseTo(minScaleForDpiFloor(), 5);
    expect(r.scale * PDF_POINTS_PER_INCH).toBeCloseTo(MIN_RASTER_DPI, 5);
    expect(r.pixels).toBeLessThanOrEqual(MAX_PIXELS_PER_PAGE);
  });

  it("clamps an explicit oversized requested scale instead of rejecting", () => {
    const r = computeAdaptiveScale({ widthPt: 612, heightPt: 792, requestedScale: 100 });
    expect(r.pixelCapApplied).toBe(true);
    expect(r.pixels).toBeLessThanOrEqual(MAX_PIXELS_PER_PAGE);
    expect(r.scale).toBeLessThan(100);
  });
});
