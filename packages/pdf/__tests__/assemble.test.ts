import { describe, expect, it } from "vitest";
import { assembleMaterial, type MaterialBlock } from "../assemble";

describe("assembleMaterial", () => {
  it("orders blocks by page ascending, then y descending within a page", () => {
    const blocks: MaterialBlock[] = [
      { kind: "text", pageNumber: 2, y: 100, markdown: "page2-bottom" },
      { kind: "text", pageNumber: 1, y: 100, markdown: "page1-bottom" },
      { kind: "text", pageNumber: 1, y: 700, markdown: "page1-top" },
      { kind: "text", pageNumber: 2, y: 700, markdown: "page2-top" },
    ];
    const result = assembleMaterial(blocks);
    const p1Top = result.indexOf("page1-top");
    const p1Bottom = result.indexOf("page1-bottom");
    const p2Top = result.indexOf("page2-top");
    const p2Bottom = result.indexOf("page2-bottom");
    expect(p1Top).toBeGreaterThanOrEqual(0);
    expect(p1Top).toBeLessThan(p1Bottom);
    expect(p1Bottom).toBeLessThan(p2Top);
    expect(p2Top).toBeLessThan(p2Bottom);
  });

  it("splices a figure block into its vertical position between text blocks", () => {
    const blocks: MaterialBlock[] = [
      { kind: "text", pageNumber: 1, y: 700, markdown: "intro text" },
      { kind: "figure", pageNumber: 1, y: 500, description: "a diagram of a cell" },
      { kind: "text", pageNumber: 1, y: 300, markdown: "closing text" },
    ];
    const result = assembleMaterial(blocks);
    const introIdx = result.indexOf("intro text");
    const figureIdx = result.indexOf("[Figura: a diagram of a cell]");
    const closingIdx = result.indexOf("closing text");
    expect(introIdx).toBeLessThan(figureIdx);
    expect(figureIdx).toBeLessThan(closingIdx);
  });

  it("a cloud-page block replaces/represents the whole page and sorts first on its page", () => {
    const blocks: MaterialBlock[] = [
      { kind: "cloud-page", pageNumber: 1, markdown: "# Formula page transcribed by Haiku" },
      { kind: "text", pageNumber: 2, y: 700, markdown: "next page local text" },
    ];
    const result = assembleMaterial(blocks);
    expect(result).toContain("Formula page transcribed by Haiku");
    const cloudIdx = result.indexOf("Formula page transcribed by Haiku");
    const nextIdx = result.indexOf("next page local text");
    expect(cloudIdx).toBeLessThan(nextIdx);
  });

  it("normalizes triple+ newlines down to a single blank line, idempotently", () => {
    const blocks: MaterialBlock[] = [
      { kind: "text", pageNumber: 1, y: 700, markdown: "one\n\n\n\ntwo" },
      { kind: "figure", pageNumber: 1, y: 400, description: "x" },
      { kind: "text", pageNumber: 1, y: 100, markdown: "three" },
    ];
    const once = assembleMaterial(blocks);
    expect(once).not.toMatch(/\n{3,}/);

    // Idempotence: re-running assemble on a single pre-normalized text block
    // matching the prior output must not change it further.
    const twice = assembleMaterial([{ kind: "text", pageNumber: 1, y: 0, markdown: once }]);
    expect(twice).toBe(once);
  });

  it("returns an empty string for no blocks", () => {
    expect(assembleMaterial([])).toBe("");
  });
});
