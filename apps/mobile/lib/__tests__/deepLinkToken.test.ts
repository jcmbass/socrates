import { describe, expect, it } from "vitest";
import { normalizeDeepLinkToken } from "../deepLinkToken";

describe("normalizeDeepLinkToken", () => {
  it("passes through a single string token", () => {
    expect(normalizeDeepLinkToken("abc123")).toBe("abc123");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDeepLinkToken("  abc123  ")).toBe("abc123");
  });

  it("takes the first value when expo-router delivers an array (repeated ?token=)", () => {
    expect(normalizeDeepLinkToken(["first", "second"])).toBe("first");
  });

  it("returns null for undefined (no token param present)", () => {
    expect(normalizeDeepLinkToken(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(normalizeDeepLinkToken("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(normalizeDeepLinkToken("   ")).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(normalizeDeepLinkToken([])).toBeNull();
  });
});
