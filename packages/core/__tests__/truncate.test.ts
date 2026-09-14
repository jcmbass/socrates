import { describe, expect, it } from "vitest";
import {
  truncateMaterial,
  estimateTokens,
  MAX_TOKENS,
  HEAD_TOKENS,
  TAIL_TOKENS,
  CHARS_PER_TOKEN,
} from "../truncate";

describe("truncateMaterial", () => {
  it("returns empty input untouched", () => {
    const result = truncateMaterial("");
    expect(result).toEqual({ text: "", truncated: false, droppedTokens: 0 });
  });

  it("keeps material under the 32K token budget whole", () => {
    const text = "a".repeat(1000 * CHARS_PER_TOKEN); // 1000 tokens
    const result = truncateMaterial(text);
    expect(result.truncated).toBe(false);
    expect(result.droppedTokens).toBe(0);
    expect(result.text).toBe(text);
  });

  it("keeps material at exactly the 32K token boundary whole (no off-by-one)", () => {
    const text = "a".repeat(MAX_TOKENS * CHARS_PER_TOKEN);
    const result = truncateMaterial(text);
    expect(estimateTokens(text)).toBe(MAX_TOKENS);
    expect(result.truncated).toBe(false);
    expect(result.droppedTokens).toBe(0);
    expect(result.text).toBe(text);
  });

  it("truncates material over budget, keeping head + tail and dropping the middle", () => {
    // head marker + huge middle + tail marker, well over 32K tokens
    const head = "HEAD_MARKER_" + "a".repeat(HEAD_TOKENS * CHARS_PER_TOKEN);
    const middle = "b".repeat(5000 * CHARS_PER_TOKEN);
    const tail = "z".repeat(TAIL_TOKENS * CHARS_PER_TOKEN) + "_TAIL_MARKER";
    const text = head + middle + tail;

    const result = truncateMaterial(text);

    expect(result.truncated).toBe(true);
    expect(result.droppedTokens).toBeGreaterThan(0);
    expect(result.text).toContain("HEAD_MARKER_");
    expect(result.text).toContain("_TAIL_MARKER");
    expect(result.text).not.toContain("b".repeat(100));
  });
});
