import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildTemarioDraft,
  DEFAULT_TOC_CONFIDENCE_THRESHOLD,
  findTocPages,
  outlineToTocLocator,
  parseTocText,
  scoreTocPage,
  type OutlineEntry,
  type TocEntry,
} from "../toc";
import type { NormalizedPage, TextItem, PathStat } from "../types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "__fixtures__", "toc");

function loadPage(name: string): NormalizedPage {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));
}

function loadOutline(name: string): OutlineEntry[] {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));
}

function loadText(name: string): string {
  return readFileSync(path.join(FIXTURES, `${name}.txt`), "utf8");
}

// ---------------------------------------------------------------------------
// findTocPages / scoreTocPage — measured against all 8 sondeo PDFs.
// ---------------------------------------------------------------------------

describe("scoreTocPage on real PDFs (sondeo del arquitecto, 8 PDFs de docs/)", () => {
  it("flags introduction-to-algorithms page 3 (the real Contents page) with high confidence", () => {
    const result = scoreTocPage(loadPage("algorithms-p3"));
    expect(result.confidence).toBeGreaterThanOrEqual(DEFAULT_TOC_CONFIDENCE_THRESHOLD);
    expect(result.confidence).toBeCloseTo(0.684, 2);
    expect(result.signals.headerMatch).toBe(true);
    expect(result.signals.pageNumberPairRatio).toBeGreaterThan(0.6);
  });

  it("flags introduction-to-algorithms page 4 (continuation of the same Contents section)", () => {
    const result = scoreTocPage(loadPage("algorithms-p4"));
    expect(result.confidence).toBeGreaterThanOrEqual(DEFAULT_TOC_CONFIDENCE_THRESHOLD);
    expect(result.signals.headerMatch).toBe(true);
  });

  // Negative cases: every one of these looked like it COULD trip a naive
  // heuristic (short lines, numbered lists, formulas) but measured well
  // under threshold. Listed with the real page and WHY it's a near-miss.
  it.each([
    ["algorithms-p1-title", "title page, no index content at all"],
    ["algorithms-p11-lecture-notes", "real chapter content — prose + bullets, not an index"],
    ["calculo-p1-slide", "near-empty title slide (roman-numeral course code 'III' must NOT be read as a page number)"],
    ["calculo-p6-formula-slide", "formula-heavy lecture slide"],
    ["guia1-p2-lista-numerada", "numbered problem list ('13)', '14)'...) — numbering alone isn't an index"],
    ["guiaINEC2-p3-lista-con-glifos-rotos", "numbered list with fragmented/garbled glyphs from absolute-value bars"],
    ["prosa-bio-p1", "single flowing prose paragraph"],
    ["quimica-p1-title", "title page"],
    ["quimica-p4-objetivos-prose", "dense prose section (OBJETIVOS), no header/page-number pairing"],
    ["quimica-p5-programa-temario-en-prosa", "KNOWN HARD CASE: this page's 'Tema N: ...' headers ARE effectively the real syllabus, embedded in prose with no page-number pointers — correctly NOT flagged as an index page, because it isn't one (see docs/plan-temario-indice/00-plan.md riesgos)"],
  ])("does NOT flag %s as a TOC page (%s)", (name) => {
    const result = scoreTocPage(loadPage(name as string));
    expect(result.confidence).toBeLessThan(DEFAULT_TOC_CONFIDENCE_THRESHOLD);
  });

  it("handles a page with zero extractable text (scanned slide deck) without crashing", () => {
    const result = scoreTocPage(loadPage("distributed-node-p1-empty"));
    expect(result.confidence).toBe(0);
    expect(result.signals.lineCount).toBe(0);
  });
});

describe("findTocPages", () => {
  it("returns exactly the real Contents pages (3, 4), in page order, out of a 4-page mixed sample", () => {
    const pages = [
      loadPage("algorithms-p1-title"),
      loadPage("algorithms-p3"),
      loadPage("algorithms-p4"),
      loadPage("algorithms-p11-lecture-notes"),
    ];
    const found = findTocPages(pages);
    expect(found.map((c) => c.pageNumber)).toEqual([3, 4]);
  });

  it("finds nothing across calculo-multivariable.pdf's own pages (verified: this document has NO index page anywhere in its 32 pages, grepped for Índice/Contenido/Temario/Contents/Sumario)", () => {
    const pages = [loadPage("calculo-p1-slide"), loadPage("calculo-p6-formula-slide")];
    expect(findTocPages(pages)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Synthetic fixtures — isolate signals real data barely exercises
// (ascendingRunRatio, dotLeaderRatio: none of the 8 sondeo PDFs' extracted
// text contains literal dot leaders or a flat pure-integer page sequence).
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

function emptyPaths(): PathStat {
  return { horizontalSegments: 0, verticalSegments: 0, rectangles: 0 };
}

function textItem(overrides: Partial<TextItem>): TextItem {
  return { str: "word", x: 0, y: 700, width: 20, height: 10, fontName: "Helvetica", ...overrides };
}

/** Builds a page from a list of ROWS, each row a list of (str, x) placed at the same y, one row per decreasing y — i.e. already in reading order. */
function pageFromRows(rows: Array<Array<[string, number]>>): NormalizedPage {
  const textItems: TextItem[] = [];
  rows.forEach((row, i) => {
    const y = 750 - i * 14;
    row.forEach(([str, x]) => textItems.push(textItem({ str, x, y })));
  });
  return {
    pageNumber: 1,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    textItems,
    images: [],
    paths: emptyPaths(),
  };
}

describe("scoreTocPage — synthetic isolation of individual signals", () => {
  it("dotLeaderRatio: a classic dot-leader index with an ascending flat page sequence scores very high", () => {
    const rows: Array<Array<[string, number]>> = [
      [["Índice", 250]],
      [["Introducción", 50], ["..........", 250], ["1", 400]],
      [["Capítulo 1: Fundamentos", 50], ["..........", 250], ["5", 400]],
      [["Capítulo 2: Avanzado", 50], ["..........", 250], ["12", 400]],
      [["Capítulo 3: Cierre", 50], ["..........", 250], ["20", 400]],
    ];
    const result = scoreTocPage(pageFromRows(rows));
    expect(result.signals.headerMatch).toBe(true);
    expect(result.signals.dotLeaderRatio).toBeGreaterThan(0);
    expect(result.signals.ascendingRunRatio).toBe(1);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("ascendingRunRatio: a descending page-number column (corrupt/out-of-order extraction) is NOT rewarded by that signal", () => {
    const rows: Array<Array<[string, number]>> = [
      [["Contents", 250]],
      [["Section A", 50], ["20", 400]],
      [["Section B", 50], ["12", 400]],
      [["Section C", 50], ["5", 400]],
    ];
    const result = scoreTocPage(pageFromRows(rows));
    expect(result.signals.ascendingRunRatio).toBe(0);
  });

  it("headerMatch alone (no other signal) does not clear the threshold", () => {
    const rows: Array<Array<[string, number]>> = [
      [["Índice", 250]],
      [
        ["This", 0],
        ["is", 40],
        ["just", 60],
        ["ordinary", 100],
        ["flowing", 170],
        ["prose", 230],
        ["that", 280],
        ["happens", 320],
        ["to", 400],
        ["sit", 420],
        ["under", 450],
        ["a", 500],
        ["heading", 520],
      ],
    ];
    const result = scoreTocPage(pageFromRows(rows));
    expect(result.signals.headerMatch).toBe(true);
    expect(result.confidence).toBeLessThan(DEFAULT_TOC_CONFIDENCE_THRESHOLD);
  });

  it("an all-uppercase roman numeral suffix in ordinary text (course code) is not read as a page number", () => {
    const rows: Array<Array<[string, number]>> = [[["MATEMÁTICA", 0], ["III", 100]]];
    const result = scoreTocPage(pageFromRows(rows));
    expect(result.signals.pageNumberPairRatio).toBe(0);
  });

  it("English header vocabulary ('Contents') and Spanish ('Índice'/'Temario'/'Sumario') both trigger headerMatch", () => {
    for (const header of ["Contents", "Índice", "Temario", "Sumario", "Tabla de Contenidos"]) {
      const result = scoreTocPage(pageFromRows([[[header, 250]]]));
      expect(result.signals.headerMatch).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// outlineToTocLocator
// ---------------------------------------------------------------------------

describe("outlineToTocLocator", () => {
  it("locates the real Contents page from introduction-to-algorithms' own outline (entry 1 of 12 loaded)", () => {
    const outline = loadOutline("algorithms-outline");
    expect(outlineToTocLocator(outline)).toEqual({
      kind: "toc-page",
      pageNumber: 3,
      matchedTitle: "Contents",
    });
  });

  it("returns 'none' for the founder's exact diagnosed case: 22 real bare 'Chapter N' entries, no names, no locator", () => {
    const outline = loadOutline("algorithms-outline-bare-chapters");
    expect(outline.length).toBe(22);
    expect(outline.every((e) => /^Chapter \d+$/.test(e.title))).toBe(true);
    expect(outlineToTocLocator(outline)).toEqual({ kind: "none" });
  });

  it("locates the real Contents-equivalent page from guia_docente_quimica_general's UNMODIFIED outline (its own 'IV.- CONTENIDOS' entry, which genuinely does point at the syllabus)", () => {
    const outline = loadOutline("quimica-outline");
    expect(outlineToTocLocator(outline)).toEqual({
      kind: "toc-page",
      pageNumber: 5,
      matchedTitle: "IV.- CONTENIDOS",
    });
  });

  it("reports a rich-but-unlocated outline as 'outline-rich' (quimica outline with its own locator entry removed)", () => {
    const outline = loadOutline("quimica-outline-without-contenidos");
    expect(outline.length).toBe(9);
    expect(outlineToTocLocator(outline)).toEqual({ kind: "outline-rich", entryCount: 9 });
  });

  it("returns 'none' for an empty outline (calculo-multivariable.pdf: verified 0 outline entries)", () => {
    const outline = loadOutline("calculo-outline");
    expect(outline).toEqual([]);
    expect(outlineToTocLocator(outline)).toEqual({ kind: "none" });
  });

  it("does not call 1-2 rich entries 'rich' (MIN_OUTLINE_ENTRIES_FOR_RICHNESS guards tiny outlines)", () => {
    const outline: OutlineEntry[] = [{ level: 1, title: "A Very Descriptive Single Entry", pageNumber: 1 }];
    expect(outlineToTocLocator(outline)).toEqual({ kind: "none" });
  });
});

// ---------------------------------------------------------------------------
// parseTocText — real extracted text from algorithms pages 3 and 4.
// ---------------------------------------------------------------------------

describe("parseTocText on real extracted text (introduction-to-algorithms pages 3-4)", () => {
  const p3 = parseTocText(loadText("algorithms-toc-p3"));
  const p4 = parseTocText(loadText("algorithms-toc-p4"));

  it("skips the leading 'Contents' header (page 3) and 'iv' + 'Contents' running header (page 4)", () => {
    expect(p3[0]?.title).not.toBe("Contents");
    expect(p4[0]?.title).not.toBe("iv");
    expect(p4[0]?.title).not.toBe("Contents");
  });

  it("pairs a chapter title that has NO page number of its own with level 1, and its 'Lecture Notes'/'Solutions' children (title/number on SEPARATE lines) with level 2 + their real page tokens", () => {
    const chapter2 = p3.find((e) => e.title === "Chapter 2: Getting Started");
    expect(chapter2).toEqual({ title: "Chapter 2: Getting Started", pageNumber: null, level: 1 });

    const idx = p3.indexOf(chapter2 as TocEntry);
    expect(p3[idx + 1]).toEqual({ title: "Lecture Notes", pageNumber: "2-1", level: 2 });
    expect(p3[idx + 2]).toEqual({ title: "Solutions", pageNumber: "2-16", level: 2 });
  });

  it("parses every chapter heading across both pages (22 total: 14 on p3, 8 on p4)", () => {
    const chapters = [...p3, ...p4].filter((e) => e.level === 1);
    expect(chapters).toHaveLength(22);
    expect(chapters[0].title).toBe("Chapter 2: Getting Started");
    expect(chapters[chapters.length - 1].title).toBe("Chapter 27: Sorting Networks");
  });

  it("KNOWN LIMITATION (documented in code): front-matter entries without a chapter-marker keyword ('Revision History', 'Preface') default to level 2 — text-only level inference has no indentation to fall back on", () => {
    expect(p3[0]).toEqual({ title: "Revision History", pageNumber: "R-1", level: 2 });
    expect(p3[1]).toEqual({ title: "Preface", pageNumber: "P-1", level: 2 });
  });

  it("KNOWN LIMITATION (documented in code): the trailing 'Index' entry also has no chapter-marker keyword and is misclassified as level 2, not its own top-level back-matter entry", () => {
    const last = p4[p4.length - 1];
    expect(last).toEqual({ title: "Index", pageNumber: "I-1", level: 2 });
  });
});

describe("parseTocText — synthetic cases", () => {
  it("parses same-line dot-leader entries and strips the dots from the title", () => {
    const entries = parseTocText("Introducción .......... 1\nCapítulo 1: Fundamentos ..... 5");
    expect(entries).toEqual([
      { title: "Introducción", pageNumber: "1", level: 2 },
      { title: "Capítulo 1: Fundamentos", pageNumber: "5", level: 1 },
    ]);
  });

  it("infers level from hierarchical numbering depth (1 / 1.2 / 1.2.3)", () => {
    const entries = parseTocText("1 Introducción\n1.2 Motivación\n1.2.3 Alcance");
    expect(entries.map((e) => e.level)).toEqual([1, 2, 3]);
  });

  it("recognizes 'Capítulo N' and 'Tema N' as level 1 (Spanish chapter markers)", () => {
    const entries = parseTocText("Capítulo 1: Álgebra\nTema 2: Cálculo");
    expect(entries.every((e) => e.level === 1)).toBe(true);
  });

  it("returns an empty list for text with no lines (defensive/edge case)", () => {
    expect(parseTocText("")).toEqual([]);
    expect(parseTocText("   \n  \n")).toEqual([]);
  });

  it("a title with no following page-number line gets pageNumber: null instead of consuming the next unrelated line", () => {
    const entries = parseTocText("Capítulo 1: Introducción\nEsta es la primera oración del capítulo.");
    expect(entries[0]).toEqual({ title: "Capítulo 1: Introducción", pageNumber: null, level: 1 });
    expect(entries[1]).toEqual({
      title: "Esta es la primera oración del capítulo.",
      pageNumber: null,
      level: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// buildTemarioDraft
// ---------------------------------------------------------------------------

describe("buildTemarioDraft", () => {
  it("groups the full real 22-chapter algorithms index into chapters with their Lecture Notes/Solutions sections nested underneath", () => {
    const entries = [
      ...parseTocText(loadText("algorithms-toc-p3")),
      ...parseTocText(loadText("algorithms-toc-p4")),
    ];
    const draft = buildTemarioDraft(entries);

    expect(draft.chapters).toHaveLength(22);
    expect(draft.chapters[0]).toEqual({
      title: "Chapter 2: Getting Started",
      pageNumber: null,
      sections: [
        { title: "Lecture Notes", pageNumber: "2-1", level: 2 },
        { title: "Solutions", pageNumber: "2-16", level: 2 },
      ],
    });

    // "Revision History" and "Preface" precede the first level-1 chapter
    // heading (see parseTocText's documented level-inference limitation)
    // — kept as orphans, not silently dropped.
    expect(draft.orphanSections).toEqual([
      { title: "Revision History", pageNumber: "R-1", level: 2 },
      { title: "Preface", pageNumber: "P-1", level: 2 },
    ]);
  });

  it("does not invent a recorte: every entry from the source index survives into the draft untouched", () => {
    const entries = parseTocText(loadText("algorithms-toc-p3"));
    const draft = buildTemarioDraft(entries);
    const totalInDraft =
      draft.orphanSections.length +
      draft.chapters.reduce((sum, c) => sum + 1 + c.sections.length, 0);
    expect(totalInDraft).toBe(entries.length);
  });

  it("a plain flat list (no level>=2 children) produces chapters with empty sections and no orphans", () => {
    const entries: TocEntry[] = [
      { title: "Uno", pageNumber: "1", level: 1 },
      { title: "Dos", pageNumber: "2", level: 1 },
    ];
    const draft = buildTemarioDraft(entries);
    expect(draft.chapters).toEqual([
      { title: "Uno", pageNumber: "1", sections: [] },
      { title: "Dos", pageNumber: "2", sections: [] },
    ]);
    expect(draft.orphanSections).toEqual([]);
  });
});
