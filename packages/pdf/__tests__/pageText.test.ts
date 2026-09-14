import { describe, expect, it } from "vitest";
import { pageTextToMarkdown } from "../pageText";
import type { NormalizedPage, TextItem } from "../types";

function textItem(overrides: Partial<TextItem>): TextItem {
  return {
    str: "word",
    x: 0,
    y: 700,
    width: 20,
    height: 10,
    fontName: "Helvetica",
    ...overrides,
  };
}

function page(textItems: TextItem[]): NormalizedPage {
  return {
    pageNumber: 1,
    width: 612,
    height: 792,
    textItems,
    images: [],
    paths: { horizontalSegments: 0, verticalSegments: 0, rectangles: 0 },
  };
}

describe("pageTextToMarkdown", () => {
  it("returns an empty string for an empty page", () => {
    expect(pageTextToMarkdown(page([]))).toBe("");
  });

  it("joins a single line's words in ascending x order regardless of input order", () => {
    const items = [
      textItem({ str: "fox", x: 120, y: 700 }),
      textItem({ str: "The", x: 0, y: 700 }),
      textItem({ str: "brown", x: 60, y: 700 }),
    ];
    expect(pageTextToMarkdown(page(items))).toBe("The brown fox");
  });

  it("groups items within the y tolerance into the same line, and different y into separate lines", () => {
    const items = [
      textItem({ str: "line1-a", x: 0, y: 700 }),
      textItem({ str: "line1-b", x: 50, y: 701 }), // within tolerance of 700
      textItem({ str: "line2-a", x: 0, y: 686 }), // 14pt below: new line, small gap
    ];
    const result = pageTextToMarkdown(page(items));
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("line1-a line1-b");
    expect(lines[1]).toBe("line2-a");
  });

  it("orders lines top-to-bottom regardless of input order", () => {
    const items = [
      textItem({ str: "bottom", x: 0, y: 100 }),
      textItem({ str: "top", x: 0, y: 700 }),
      textItem({ str: "middle", x: 0, y: 400, height: 10 }),
    ];
    const result = pageTextToMarkdown(page(items));
    const topIdx = result.indexOf("top");
    const middleIdx = result.indexOf("middle");
    const bottomIdx = result.indexOf("bottom");
    expect(topIdx).toBeLessThan(middleIdx);
    expect(middleIdx).toBeLessThan(bottomIdx);
  });

  it("splits paragraphs on a large y gap between lines but keeps close lines together", () => {
    const items = [
      textItem({ str: "para1-line1", x: 0, y: 700, height: 10 }),
      textItem({ str: "para1-line2", x: 0, y: 686, height: 10 }), // 14pt gap, normal single-spacing
      // Big gap to next paragraph: > 1.8 * 10 = 18
      textItem({ str: "para2-line1", x: 0, y: 640, height: 10 }),
    ];
    const result = pageTextToMarkdown(page(items));
    expect(result).toBe("para1-line1\npara1-line2\n\npara2-line1");
  });

  it("filters out lines that end up empty after trimming (whitespace-only items)", () => {
    const items = [
      textItem({ str: "  ", x: 0, y: 700 }),
      textItem({ str: "real text", x: 0, y: 650 }),
    ];
    const result = pageTextToMarkdown(page(items));
    expect(result).toBe("real text");
  });
});
