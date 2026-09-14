import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveKeyboardBottomPadding } from "../keyboardInsets";

describe("resolveKeyboardBottomPadding", () => {
  it("uses the Android safe area while the keyboard is closed", () => {
    expect(resolveKeyboardBottomPadding("android", 0, 24)).toBe(24);
  });

  it("uses the full Android keyboard height without adding the nav inset", () => {
    expect(resolveKeyboardBottomPadding("android", 320, 24)).toBe(320);
  });

  it("returns only the keyboard delta when GuidedSession owns the safe area", () => {
    expect(resolveKeyboardBottomPadding("android", 0, 24, true)).toBe(0);
    expect(resolveKeyboardBottomPadding("android", 320, 24, true)).toBe(296);
  });

  it("does not duplicate the iOS inset under KeyboardAvoidingView", () => {
    expect(resolveKeyboardBottomPadding("ios", 320, 24, true)).toBe(0);
    expect(resolveKeyboardBottomPadding("ios", 320, 24)).toBe(24);
  });

  it("is a worklet so useAnimatedStyle can call it on the UI thread", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../keyboardInsets.ts"), "utf8");
    expect(source).toMatch(/"worklet";/);
  });
});
