import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pageTextToMarkdown } from "../pageText";
import type { NormalizedPage, TextItem } from "../types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): NormalizedPage {
  return JSON.parse(
    readFileSync(
      path.join(__dirname, "__fixtures__", "pageText", name),
      "utf8",
    ),
  ) as NormalizedPage;
}

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

function page(textItems: TextItem[], width = 612): NormalizedPage {
  return {
    pageNumber: 1,
    width,
    height: 792,
    textItems,
    images: [],
    paths: { horizontalSegments: 0, verticalSegments: 0, rectangles: 0 },
  };
}

/**
 * Index of the first occurrence of exercise marker `n)` for n in 1..12.
 * Prefers a line-start match; falls back to any `${n})` (formulas can glue
 * "11)" onto the previous token after column assembly).
 */
function exerciseIndex(md: string, n: number): number {
  const lineStart = md.search(new RegExp(`(?:^|\\n)\\s*${n}\\)`));
  if (lineStart >= 0) {
    const slice = md.slice(lineStart);
    const m = slice.match(new RegExp(`(?:^|\\n)\\s*(${n})\\)`));
    if (m && m.index !== undefined) {
      return lineStart + m.index + m[0].indexOf(String(n));
    }
  }
  return md.indexOf(`${n})`);
}

describe("pageTextToMarkdown column-aware reading order", () => {
  it("emits guiaVA3 p1 exercises 1..12 in logical column order (not row-interleaved)", () => {
    const md = pageTextToMarkdown(loadFixture("guiaVA3-p1.json"));
    const idxs = Array.from({ length: 12 }, (_, i) => exerciseIndex(md, i + 1));
    expect(idxs.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < idxs.length; i++) {
      expect(idxs[i]).toBeGreaterThan(idxs[i - 1]);
    }
    // Guard against the historical bug: row-wise Y-then-X put 7) before 2).
    expect(idxs[6]).toBeGreaterThan(idxs[5]); // 7 after 6
    expect(idxs[1]).toBeLessThan(idxs[6]); // 2 before 7
  });

  it("keeps prosa-bio (single-column justified prose) identical to row-wise assembly", () => {
    const fixture = loadFixture("prosa-bio-p1.json");
    const md = pageTextToMarkdown(fixture);
    const expected = readFileSync(
      path.join(
        __dirname,
        "__fixtures__",
        "pageText",
        "prosa-bio-p1.expected.md",
      ),
      "utf8",
    );
    // Golden: false two-column split would reorder/fragment this prose.
    expect(md).toBe(expected);
    // Also: tiny page width cannot invent a mid-band gutter.
    expect(pageTextToMarkdown({ ...fixture, width: 10 })).toBe(expected);
  });

  it("does not invent columns for multi-word justified prose (row-wise unchanged)", () => {
    // Words at cumulative x across a NARROW measure so mid-page sits inside
    // the line — a forced mid split would cut "jumps" onto the right column.
    const rows = [
      ["The", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog."],
      ["Meanwhile,", "a", "second", "sentence", "continues", "the", "paragraph"],
      ["with", "different", "word", "lengths", "so", "columns", "never", "align."],
      ["Photosynthesis", "converts", "light", "energy", "into", "chemical", "bonds."],
      ["Consider", "the", "following", "short", "example", "of", "flowing", "text."],
      ["Each", "line", "here", "has", "its", "own", "distinct", "shape", "and", "length."],
    ];
    const textItems: TextItem[] = [];
    rows.forEach((words, row) => {
      let x = 10;
      for (const w of words) {
        textItems.push(
          textItem({ str: w, x, y: 700 - row * 14, width: w.length * 7 }),
        );
        x += w.length * 7 + 4;
      }
    });
    // Page width ~ mid of the first line (~150) so a naive pageWidth/2 split
    // lands between words.
    const md = pageTextToMarkdown(page(textItems, 300));
    expect(md.split("\n")[0]).toBe(
      "The quick brown fox jumps over the lazy dog.",
    );
    expect(md.indexOf("The quick")).toBeLessThan(md.indexOf("Meanwhile"));
    expect(md.indexOf("Meanwhile")).toBeLessThan(md.indexOf("Photosynthesis"));
  });

  it("synthetic two-column page: left column then right column (not interleaved)", () => {
    // Two stable columns with a wide gutter; markers on matching y rows.
    const items: TextItem[] = [];
    for (let i = 0; i < 4; i++) {
      const y = 700 - i * 40;
      items.push(textItem({ str: `${i + 1})`, x: 50, y, width: 20 }));
      items.push(
        textItem({ str: `left-${i + 1}`, x: 80, y, width: 60 }),
      );
      items.push(textItem({ str: `${i + 5})`, x: 320, y, width: 20 }));
      items.push(
        textItem({ str: `right-${i + 5}`, x: 350, y, width: 60 }),
      );
    }
    const md = pageTextToMarkdown(page(items, 600));
    const pos = (s: string) => md.indexOf(s);
    expect(pos("1)")).toBeLessThan(pos("2)"));
    expect(pos("2)")).toBeLessThan(pos("3)"));
    expect(pos("3)")).toBeLessThan(pos("4)"));
    expect(pos("4)")).toBeLessThan(pos("5)"));
    expect(pos("5)")).toBeLessThan(pos("6)"));
    expect(pos("6)")).toBeLessThan(pos("7)"));
    expect(pos("7)")).toBeLessThan(pos("8)"));
    // Interleave bug would put "1) … 5)" on the same visual row region.
    const i1 = md.indexOf("1)");
    const i5 = md.indexOf("5)");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i5).toBeGreaterThan(i1);
    expect(md.slice(i1, i5)).toContain("4)");
  });
});
