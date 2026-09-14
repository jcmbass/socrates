import { describe, expect, it } from "vitest";
import { shouldRunOrbPulse } from "../orbPulse";

describe("shouldRunOrbPulse — la guardia que evita animar en reposo", () => {
  it("anima solo cuando hay trabajo real", () => {
    expect(shouldRunOrbPulse(true, false)).toBe(true);
  });

  it("NO anima en reposo — el caso que causó 100% de jank en el e13", () => {
    expect(shouldRunOrbPulse(false, false)).toBe(false);
  });

  it("NO anima con reduce-motion, aunque haya trabajo", () => {
    expect(shouldRunOrbPulse(true, true)).toBe(false);
  });

  it("en reposo Y con reduce-motion tampoco", () => {
    expect(shouldRunOrbPulse(false, true)).toBe(false);
  });
});
