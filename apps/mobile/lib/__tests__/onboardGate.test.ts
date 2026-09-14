import { describe, expect, it } from "vitest";

import { needsOnboarding } from "../onboardGate";

describe("needsOnboarding (D-C07 — onboardingCompletedAt, not course count)", () => {
  it("is true when onboardingCompletedAt is null (never finished, or a pre-C2-c tester with courses already)", () => {
    expect(needsOnboarding({ onboardingCompletedAt: null })).toBe(true);
  });

  it("is false once onboardingCompletedAt is set", () => {
    expect(needsOnboarding({ onboardingCompletedAt: "2026-09-01T00:00:00.000Z" })).toBe(false);
  });
});
