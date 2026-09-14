import { describe, expect, it } from "vitest";
import {
  classifyPage,
  DEFAULT_THRESHOLDS,
  pageHasContentBearingFigures,
  CONTENT_FIGURE_AREA_RATIO,
  CONTENT_FIGURE_SPARSE_TEXT_CHARS,
  type Thresholds,
} from "../classify";
import type { NormalizedPage, TextItem, ImageItem, PathStat } from "../types";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

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

function emptyPaths(): PathStat {
  return { horizontalSegments: 0, verticalSegments: 0, rectangles: 0 };
}

function page(overrides: Partial<NormalizedPage>): NormalizedPage {
  return {
    pageNumber: 1,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    textItems: [],
    images: [],
    paths: emptyPaths(),
    ...overrides,
  };
}

/**
 * Builds a page of ordinary reflowed prose: each row has a different
 * number of variable-length words placed at cumulative x offsets (like a
 * real text layout, where word x depends on the width of prior words on
 * the same line) — so word x positions do NOT line up into stable columns
 * across rows, unlike a real table.
 */
function cleanProsePage(): NormalizedPage {
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
    let x = 0;
    words.forEach((w) => {
      textItems.push(
        textItem({ str: w, x, y: 700 - row * 14, fontName: "Helvetica" }),
      );
      x += w.length * 6 + 6; // approximate glyph width + inter-word space
    });
  });
  return page({ textItems });
}

describe("classifyPage", () => {
  it("routes clean prose to local-text", () => {
    const result = classifyPage(cleanProsePage());
    expect(result.route).toEqual({ kind: "local-text" });
    expect(result.formulaScore).toBeLessThan(DEFAULT_THRESHOLDS.formulaScore);
    expect(result.tableScore).toBeLessThan(DEFAULT_THRESHOLDS.tableScore);
  });

  it("routes a page with CMMI math font + math unicode to cloud-page formula", () => {
    const textItems: TextItem[] = [];
    for (let i = 0; i < 6; i++) {
      textItems.push(
        textItem({ str: "x", x: i * 15, y: 700, fontName: "CMMI10", height: 10 }),
      );
    }
    // Heavy math-unicode content: integral, sum, sqrt, infinity, forall...
    textItems.push(
      textItem({ str: "∫∑√∞±≤≥≠→∀∃", x: 0, y: 650, fontName: "CMMI10" }),
    );
    const result = classifyPage(page({ textItems }));
    expect(result.route.kind).toBe("cloud-page");
    if (result.route.kind === "cloud-page") {
      expect(result.route.reason).toBe("formula");
    }
    expect(result.signals.mathFontHits).toBe(7);
    expect(result.signals.mathUnicodeRatio).toBeGreaterThan(0);
    expect(result.formulaScore).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.formulaScore);
  });

  it("routes a page with a ruled path grid to cloud-page table", () => {
    const paths: PathStat = { horizontalSegments: 5, verticalSegments: 4, rectangles: 0 };
    const result = classifyPage(page({ textItems: [textItem({})], paths }));
    expect(result.route).toEqual({ kind: "cloud-page", reason: "table" });
    expect(result.signals.ruledGrid).toBe(true);
    expect(result.tableScore).toBe(1);
  });

  it("routes a page with a borderless table (stable x columns across rows) to cloud-page table", () => {
    const textItems: TextItem[] = [];
    const columnXs = [50, 200, 350, 500];
    for (let row = 0; row < 5; row++) {
      columnXs.forEach((x) => {
        textItems.push(textItem({ str: "42", x, y: 700 - row * 20 }));
      });
    }
    const result = classifyPage(page({ textItems }));
    // The row's own leftmost item is excluded from clustering (it trivially
    // aligns in any left-justified text, table or not) — of the 4 aligned
    // columns, the 3 interior ones are what register.
    expect(result.signals.columnClusters).toBeGreaterThanOrEqual(3);
    expect(result.route).toEqual({ kind: "cloud-page", reason: "table" });
  });

  it("routes a page with an image covering 90% of area to cloud-page scanned", () => {
    const images: ImageItem[] = [
      {
        id: "img-1",
        x: 10,
        y: 10,
        width: PAGE_WIDTH * 0.95,
        height: PAGE_HEIGHT * 0.95,
      },
    ];
    const result = classifyPage(page({ images }));
    expect(result.route).toEqual({ kind: "cloud-page", reason: "scanned" });
    expect(result.signals.largestImageAreaRatio).toBeGreaterThanOrEqual(0.8);
  });

  it("routes prose with one small embedded image to local-text-with-figures", () => {
    const textItems = cleanProsePage().textItems;
    const images: ImageItem[] = [{ id: "fig-1", x: 100, y: 400, width: 80, height: 60 }];
    const result = classifyPage(page({ textItems, images }));
    expect(result.route).toEqual({
      kind: "local-text-with-figures",
      figures: images,
    });
    // Decorative: area ≪ CONTENT_FIGURE_AREA_RATIO (0.12).
    expect(result.signals.largestImageAreaRatio).toBeLessThan(0.12);
  });

  /**
   * BORDE FALTANTE, encontrado por mutación (arquitecto 2026-08-02): bajar
   * CONTENT_FIGURE_AREA_RATIO de 0.12 a 0.001 dejaba los 76 tests en verde.
   * La guardia de texto escaso sola no protege el umbral de ÁREA: la página
   * decorativa real de Química tiene 1906 chars, así que la salva el texto,
   * no el área. Este test cubre el caso que solo el área puede atrapar —
   * figura CHICA en una página con POCO texto (una portadilla, un separador
   * de sección) — que sin umbral se mandaría a transcribir por nada.
   */
  it("una figura PEQUEÑA en una página con poco texto NO se manda a la nube (solo el umbral de área lo evita)", () => {
    const images: ImageItem[] = [{ id: "logo", x: 40, y: 740, width: 60, height: 40 }];
    const textItems = [{ str: "Unidad 3", x: 72, y: 700, width: 80, height: 14, fontName: "Helvetica" }];
    const result = classifyPage(page({ textItems, images }));
    expect(result.signals.largestImageAreaRatio).toBeLessThan(0.12);
    expect(result.route.kind).not.toBe("cloud-page");
  });

  it("routes a large figure with sparse text to cloud-page figures (content)", () => {
    // Area exactly at CONTENT_FIGURE_AREA_RATIO (0.12), almost no prose —
    // mirrors calculo-multivariable content pages (area ≥0.137, ~67 chars).
    const images: ImageItem[] = [
      {
        id: "surface",
        x: 0,
        y: 0,
        width: PAGE_WIDTH * 0.12,
        height: PAGE_HEIGHT,
      },
    ];
    const textItems = [textItem({ str: "Figura 1", x: 10, y: 50 })];
    const result = classifyPage(page({ textItems, images }));
    expect(result.signals.largestImageAreaRatio).toBeCloseTo(0.12, 5);
    expect(result.route).toEqual({ kind: "cloud-page", reason: "figures" });
  });

  it("keeps a large figure on text-rich pages as local-text-with-figures", () => {
    // Same area as content, but prose volume over the sparse cut —
    // protects a decorative banner on a text-heavy guía.
    const images: ImageItem[] = [
      {
        id: "banner",
        x: 0,
        y: 0,
        width: PAGE_WIDTH * 0.12,
        height: PAGE_HEIGHT,
      },
    ];
    // Pad past CONTENT_FIGURE_SPARSE_TEXT_CHARS (300).
    const textItems = [
      ...cleanProsePage().textItems,
      textItem({
        str: " ".repeat(50) + "texto adicional de relleno para superar el umbral de prosa escasa.",
        x: 0,
        y: 500,
      }),
    ];
    const result = classifyPage(page({ textItems, images }));
    expect(result.signals.largestImageAreaRatio).toBeCloseTo(0.12, 5);
    expect(result.route).toEqual({
      kind: "local-text-with-figures",
      figures: images,
    });
  });

  it("area just under content-figure cut stays local-text-with-figures", () => {
    // Decorative side of the gap (guia_docente_quimica max measured 0.089).
    const images: ImageItem[] = [
      {
        id: "logo",
        x: 0,
        y: 0,
        width: PAGE_WIDTH * 0.119,
        height: PAGE_HEIGHT,
      },
    ];
    const textItems = [textItem({ str: "titulo", x: 10, y: 50 })];
    const result = classifyPage(page({ textItems, images }));
    expect(result.signals.largestImageAreaRatio).toBeLessThan(0.12);
    expect(result.route).toEqual({
      kind: "local-text-with-figures",
      figures: images,
    });
  });

  it("routes an empty page to local-text", () => {
    const result = classifyPage(page({}));
    expect(result.route).toEqual({ kind: "local-text" });
    expect(result.formulaScore).toBe(0);
    expect(result.tableScore).toBe(0);
    expect(result.signals.largestImageAreaRatio).toBe(0);
  });

  it("boundary: image area ratio exactly at scanned threshold routes scanned (inclusive >=)", () => {
    const images: ImageItem[] = [
      { id: "img", x: 0, y: 0, width: PAGE_WIDTH * 0.8, height: PAGE_HEIGHT },
    ];
    const result = classifyPage(page({ images }));
    expect(result.signals.largestImageAreaRatio).toBeCloseTo(0.8, 5);
    expect(result.route).toEqual({ kind: "cloud-page", reason: "scanned" });
  });

  it("boundary: image area just under scanned but over content-figure cut → figures", () => {
    // 0.79 is under scanned (0.8) but well over CONTENT_FIGURE_AREA_RATIO;
    // empty text → sparse → cloud figures (not local-text-with-figures).
    const images: ImageItem[] = [
      { id: "img", x: 0, y: 0, width: PAGE_WIDTH * 0.79, height: PAGE_HEIGHT },
    ];
    const result = classifyPage(page({ images }));
    expect(result.signals.largestImageAreaRatio).toBeLessThan(0.8);
    expect(result.route).toEqual({ kind: "cloud-page", reason: "figures" });
  });

  it("respects injected custom thresholds", () => {
    const strictThresholds: Thresholds = {
      scannedAreaRatio: 0.5,
      formulaScore: 0.01,
      tableScore: 0.99,
    };
    // A single stray Greek letter is normally not enough to cross the
    // default formulaScore threshold, but should cross a very low custom one.
    const textItems = [
      textItem({ str: "α", x: 0, y: 700 }),
      ...cleanProsePage().textItems,
    ];
    const lenient = classifyPage(page({ textItems }));
    expect(lenient.route.kind).not.toBe("cloud-page");

    const strict = classifyPage(page({ textItems }), strictThresholds);
    expect(strict.route).toEqual({ kind: "cloud-page", reason: "formula" });
  });

  it("picks the reason with the larger margin over its threshold when both qualify", () => {
    // Force both formulaScore and tableScore over threshold; formula should
    // dominate massively (max font-hit saturation + high unicode ratio).
    const textItems: TextItem[] = [];
    for (let i = 0; i < 10; i++) {
      textItems.push(textItem({ str: "∫∑√", x: i * 10, y: 700, fontName: "CMMI10" }));
    }
    const paths: PathStat = { horizontalSegments: 3, verticalSegments: 3, rectangles: 0 };
    const result = classifyPage(page({ textItems, paths }));
    expect(result.route).toEqual({ kind: "cloud-page", reason: "formula" });
  });
});

describe("pageHasContentBearingFigures (borders)", () => {
  it("fires at area cut with sparse text; stays off just under area cut", () => {
    expect(pageHasContentBearingFigures(CONTENT_FIGURE_AREA_RATIO, 67)).toBe(true);
    expect(pageHasContentBearingFigures(CONTENT_FIGURE_AREA_RATIO - 0.001, 67)).toBe(false);
  });

  it("stays off when text is not sparse even if area is large", () => {
    expect(
      pageHasContentBearingFigures(0.5, CONTENT_FIGURE_SPARSE_TEXT_CHARS),
    ).toBe(false);
    expect(
      pageHasContentBearingFigures(0.5, CONTENT_FIGURE_SPARSE_TEXT_CHARS - 1),
    ).toBe(true);
  });
});
