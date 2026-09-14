/**
 * lib/streak.ts — pure logic, tested under vitest/node with zero
 * react-native imports.
 */
import { describe, expect, it } from "vitest";
import { formatStreakCount, streakReason, streakState } from "../streak";
import type { StreakResult } from "../api/types";

describe("streakState", () => {
  it("returns 'none' for null input", () => {
    expect(streakState(null)).toBe("none");
  });

  it("returns 'none' when both current and longest are 0", () => {
    expect(streakState({ current: 0, longest: 0, reasonKeys: [] })).toBe("none");
  });

  it("returns 'active' when current > 0", () => {
    expect(streakState({ current: 3, longest: 5, reasonKeys: [] })).toBe("active");
  });

  it("returns 'active' when current equals longest", () => {
    expect(streakState({ current: 5, longest: 5, reasonKeys: [] })).toBe("active");
  });

  it("returns 'broken' when current is 0 but longest > 0", () => {
    expect(streakState({ current: 0, longest: 10, reasonKeys: [] })).toBe("broken");
  });
});

describe("formatStreakCount", () => {
  it("returns empty string for 0", () => {
    expect(formatStreakCount(0)).toBe("");
  });

  it("returns the number as string for positive values", () => {
    expect(formatStreakCount(1)).toBe("1");
    expect(formatStreakCount(42)).toBe("42");
  });

  it("returns empty string for negative values (shouldn't happen)", () => {
    expect(formatStreakCount(-1)).toBe("");
  });
});

describe("streakReason", () => {
  it("returns null for empty reasonKeys", () => {
    expect(streakReason([])).toBeNull();
  });

  it("returns 'explicaciones consistentes' for EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS", () => {
    expect(streakReason(["EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS"])).toBe("explicaciones consistentes");
  });

  it("returns 'constancia en el tiempo' for SUSTAINED_OVER_TIME", () => {
    expect(streakReason(["SUSTAINED_OVER_TIME"])).toBe("constancia en el tiempo");
  });

  it("returns the first matching reason when multiple keys present", () => {
    expect(
      streakReason(["EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS", "SUSTAINED_OVER_TIME"]),
    ).toBe("explicaciones consistentes");
  });

  it("returns null for unknown reason keys", () => {
    expect(streakReason(["UNKNOWN_KEY"])).toBeNull();
  });
});
