import { describe, expect, it } from "vitest";
import { computeIndependenceScore, computeIndependenceScoreByBand, formatScore, type ScoredTurn } from "../score";

describe("computeIndependenceScore", () => {
  it("returns null (displayed as —) for zero turns", () => {
    expect(computeIndependenceScore([])).toBeNull();
    expect(formatScore(computeIndependenceScore([]))).toBe("—");
  });

  it("excludes null-flag turns from both numerator and denominator", () => {
    const turns: ScoredTurn[] = [
      { band: "guiding", hintOffered: true },
      { band: "guiding", hintOffered: false },
      { band: "guiding", hintOffered: null }, // judge failure — must not count
    ];
    // eligible = 2 turns (1 hint, 1 no-hint) -> 1 - 1/2 = 0.5
    expect(computeIndependenceScore(turns)).toBe(0.5);
  });

  it("returns null when every turn has a null flag", () => {
    const turns: ScoredTurn[] = [
      { band: "probing", hintOffered: null },
      { band: "probing", hintOffered: null },
    ];
    expect(computeIndependenceScore(turns)).toBeNull();
  });

  it("computes 1.0 independence when no hints were offered", () => {
    const turns: ScoredTurn[] = [
      { band: "minimal", hintOffered: false },
      { band: "minimal", hintOffered: false },
    ];
    expect(computeIndependenceScore(turns)).toBe(1);
  });

  it("computes 0.0 independence when every eligible turn had a hint", () => {
    const turns: ScoredTurn[] = [
      { band: "guiding", hintOffered: true },
      { band: "guiding", hintOffered: true },
    ];
    expect(computeIndependenceScore(turns)).toBe(0);
  });
});

describe("computeIndependenceScoreByBand", () => {
  it("computes an independent score per band and — for a band with zero turns", () => {
    const turns: ScoredTurn[] = [
      { band: "guiding", hintOffered: true },
      { band: "guiding", hintOffered: false },
      { band: "probing", hintOffered: false },
    ];
    const byBand = computeIndependenceScoreByBand(turns);
    expect(byBand.guiding).toBe(0.5);
    expect(byBand.probing).toBe(1);
    expect(byBand.minimal).toBeNull();
    expect(formatScore(byBand.minimal)).toBe("—");
  });
});

describe("formatScore", () => {
  it("formats a fraction as a rounded percentage", () => {
    expect(formatScore(0.5)).toBe("50%");
    expect(formatScore(1)).toBe("100%");
    expect(formatScore(0)).toBe("0%");
  });
});
