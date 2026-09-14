import { describe, expect, it } from "vitest";

import { glowPulse, motionOrStatic, orbPulse, pressTiming, springs } from "../motion";

// Pins the craft spec's motion vocabulary (docs/plan-diseno-craft/00-craft-spec.md
// §2.3) so a future edit that drifts from Apple's damping/response table
// fails loudly, same rule as theme/__tests__/tokens.test.ts pinning the palette.
describe("springs (craft spec §2.3)", () => {
  it("settle is critically damped, no overshoot", () => {
    expect(springs.settle).toEqual({ duration: 400, dampingRatio: 1.0 });
  });

  it("sheet is the only preset with overshoot (momentum-driven)", () => {
    expect(springs.sheet).toEqual({ duration: 300, dampingRatio: 0.8 });
    expect(springs.sheet.dampingRatio).toBeLessThan(1);
  });

  it("snap is critically damped and faster than settle", () => {
    expect(springs.snap).toEqual({ duration: 250, dampingRatio: 1.0 });
    expect(springs.snap.duration).toBeLessThan(springs.settle.duration);
  });
});

describe("pressTiming", () => {
  it("is instantaneous (100ms) per apple-design skill §1 (respond on down)", () => {
    expect(pressTiming.duration).toBe(100);
  });
});

describe("glowPulse (SkillTree recommended-node pulse, craft spec §4.1)", () => {
  it("is a 2.2s full cycle (1.1s per leg)", () => {
    expect(glowPulse.halfCycleDuration).toBe(1100);
  });
});

describe("orbPulse (header ThinkingOrb while Fuente ingest is busy)", () => {
  it("is faster than the decorative tree glow (active-work signal)", () => {
    expect(orbPulse.halfCycleDuration).toBe(800);
    expect(orbPulse.halfCycleDuration).toBeLessThan(glowPulse.halfCycleDuration);
  });
});

describe("motionOrStatic", () => {
  it("returns the motion value when reduce-motion is off", () => {
    expect(motionOrStatic(false, "spring", "static")).toBe("spring");
  });

  it("returns the static value when reduce-motion is on", () => {
    expect(motionOrStatic(true, "spring", "static")).toBe("static");
  });

  it("works with non-string values (e.g. spring config objects)", () => {
    expect(motionOrStatic(false, springs.settle, null)).toBe(springs.settle);
    expect(motionOrStatic(true, springs.settle, null)).toBeNull();
  });
});
