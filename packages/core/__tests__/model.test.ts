import { describe, expect, it } from "vitest";
import { resolveModelKey, TUTOR_MODEL_IDS } from "../model";

describe("resolveModelKey", () => {
  it("returns fallback when envValue is undefined", () => {
    expect(resolveModelKey(undefined, "sonnet")).toBe("sonnet");
    expect(resolveModelKey(undefined, "haiku")).toBe("haiku");
  });

  it("returns fallback when envValue is empty string", () => {
    expect(resolveModelKey("", "sonnet")).toBe("sonnet");
    expect(resolveModelKey("", "haiku")).toBe("haiku");
  });

  it("returns valid model key for known values", () => {
    expect(resolveModelKey("sonnet", "sonnet")).toBe("sonnet");
    expect(resolveModelKey("haiku", "sonnet")).toBe("haiku");
  });

  it("throws an error with a useful message for invalid values", () => {
    expect(() => resolveModelKey("gpt4", "sonnet")).toThrow(
      /Invalid model key: "gpt4".*sonnet.*haiku/,
    );
  });

  it("throws an error for unknown model keys", () => {
    expect(() => resolveModelKey("claude-3", "sonnet")).toThrow(
      /Invalid model key/,
    );
  });

  it("defaults to sonnet (the pre-plan behavior) when no env is set", () => {
    // This is the key invariant: without env vars, behaviour is identical
    // to the pre-plan MODEL_ID = "claude-sonnet-5".
    expect(resolveModelKey(undefined, "sonnet")).toBe("sonnet");
    expect(TUTOR_MODEL_IDS[resolveModelKey(undefined, "sonnet")]).toBe("claude-sonnet-5");
  });
});