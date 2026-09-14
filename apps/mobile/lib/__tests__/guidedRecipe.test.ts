import { describe, expect, it } from "vitest";

import type { GuidedItemPublic } from "../api/types";
import {
  avoidRepeatVariant,
  baseRecipeVariant,
  buildDegradedSteps,
  buildRecipeSteps,
  hashString,
  isDegradedSession,
  shouldShowGeneralContent,
  nextMicrocopyIndex,
  pickByDifficulty,
  resolveRecipeVariant,
  xpLevelProgress,
} from "../guidedRecipe";

function item(overrides: Partial<GuidedItemPublic> & { id: string }): GuidedItemPublic {
  return {
    type: "elige",
    difficulty: 1,
    prompt: overrides.id,
    options: ["a", "b"],
    explanation: "because",
    ...overrides,
  };
}

describe("hashString + variant", () => {
  it("is stable for the same input", () => {
    expect(hashString("u1:t1")).toBe(hashString("u1:t1"));
  });

  it("baseRecipeVariant is in 0..2", () => {
    const v = baseRecipeVariant("user-a", "topic-b");
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(3);
  });

  it("avoidRepeatVariant skips repeating the last variant", () => {
    expect(avoidRepeatVariant(1, 1)).toBe(2);
    expect(avoidRepeatVariant(2, 2)).toBe(0);
    expect(avoidRepeatVariant(0, null)).toBe(0);
    expect(avoidRepeatVariant(1, 0)).toBe(1);
  });

  it("resolveRecipeVariant combines base + anti-repeat", () => {
    const base = baseRecipeVariant("u", "t");
    expect(resolveRecipeVariant("u", "t", base)).toBe((base + 1) % 3);
    expect(resolveRecipeVariant("u", "t", null)).toBe(base);
  });
});

describe("pickByDifficulty", () => {
  const items = [
    item({ id: "e1", type: "expose", difficulty: 1 }),
    item({ id: "d1", difficulty: 1 }),
    item({ id: "d2", difficulty: 2 }),
    item({ id: "d3", difficulty: 3 }),
    item({ id: "d3b", difficulty: 3 }),
  ];

  it("excludes expose items", () => {
    expect(pickByDifficulty(items, 2, "asc").map((i) => i.id)).toEqual(["d1", "d2"]);
  });

  it("picks highest difficulty for desc", () => {
    expect(pickByDifficulty(items, 2, "desc").map((i) => i.id)).toEqual(["d3", "d3b"]);
  });
});

describe("buildRecipeSteps", () => {
  const items = [
    item({ id: "x1", type: "expose", prompt: "idea 1" }),
    item({ id: "x2", type: "expose", prompt: "idea 2" }),
    item({ id: "c1", difficulty: 1, prompt: "check 1" }),
    item({ id: "c2", difficulty: 1, prompt: "check 2" }),
    item({ id: "h1", difficulty: 3, prompt: "hard 1" }),
    item({ id: "h2", difficulty: 2, prompt: "hard 2" }),
  ];

  it("orders expose → checks → explain → challenges → closure (variant 0)", () => {
    const steps = buildRecipeSteps({ items, variant: 0, fallbackExposure: ["fb1", "fb2"] });
    expect(steps.map((s) => s.kind)).toEqual(["expose", "item", "item", "explain", "item", "item", "closure"]);
    if (steps[0].kind === "expose") expect(steps[0].texts).toEqual(["idea 1", "idea 2"]);
    if (steps[1].kind === "item") expect(steps[1].phase).toBe("check");
    if (steps[4].kind === "item") expect(steps[4].phase).toBe("challenge");
  });

  it("variant 1 swaps check and challenge blocks around explain", () => {
    const steps = buildRecipeSteps({ items, variant: 1, fallbackExposure: ["fb1"] });
    expect(steps.map((s) => s.kind)).toEqual(["expose", "item", "item", "explain", "item", "item", "closure"]);
    if (steps[1].kind === "item") expect(steps[1].phase).toBe("challenge");
    if (steps[4].kind === "item") expect(steps[4].phase).toBe("check");
  });

  it("uses fallback exposure when no expose items", () => {
    const noExpose = items.filter((i) => i.type !== "expose");
    const steps = buildRecipeSteps({ items: noExpose, variant: 0, fallbackExposure: ["fb1", "fb2"] });
    if (steps[0].kind === "expose") expect(steps[0].texts).toEqual(["fb1", "fb2"]);
  });
});

describe("degraded session", () => {
  it("detects degraded flag or missing non-expose items", () => {
    expect(isDegradedSession([], true)).toBe(true);
    expect(isDegradedSession([item({ id: "e", type: "expose" })], false)).toBe(true);
    expect(isDegradedSession([item({ id: "q", difficulty: 1 })], false)).toBe(false);
  });

  it("hides the general-content label when Fuentes were required", () => {
    expect(shouldShowGeneralContent("general", null)).toBe(true);
    expect(shouldShowGeneralContent("general", "generation_failed")).toBe(true);
    expect(shouldShowGeneralContent("general", "sources_required")).toBe(false);
    expect(shouldShowGeneralContent("sources", null)).toBe(false);
    expect(shouldShowGeneralContent(null, null)).toBe(false);
  });

  it("buildDegradedSteps is expose → explain → closure", () => {
    const steps = buildDegradedSteps(["a", "b"]);
    expect(steps.map((s) => s.kind)).toEqual(["expose", "explain", "closure"]);
  });
});

describe("nextMicrocopyIndex", () => {
  it("rotates without repeating the same index twice in a row", () => {
    expect(nextMicrocopyIndex(12, null)).toBe(0);
    expect(nextMicrocopyIndex(12, 0)).toBe(1);
    expect(nextMicrocopyIndex(12, 11)).toBe(0);
  });
});

describe("xpLevelProgress", () => {
  it("uses floor(total/100)+1 and remainder progress", () => {
    expect(xpLevelProgress(0)).toEqual({ level: 1, progress: 0 });
    expect(xpLevelProgress(50)).toEqual({ level: 1, progress: 0.5 });
    expect(xpLevelProgress(100)).toEqual({ level: 2, progress: 0 });
    expect(xpLevelProgress(250)).toEqual({ level: 3, progress: 0.5 });
  });
});
