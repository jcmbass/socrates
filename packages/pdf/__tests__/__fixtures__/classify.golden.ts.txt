/**
 * Page classifier — the "brain" of the tiered ingest pipeline
 * (docs/plan-local-litert/03-fase-1-nucleo-deteccion.md).
 *
 * Pure function over `NormalizedPage`: no pdf.js, no DOM, no network. Scores
 * a page on math-formula-ness and table-ness, checks for a full-page scan,
 * and routes it to one of three tiers:
 *   - "local-text"                 — clean digital text, render locally, $0.
 *   - "local-text-with-figures"    — clean text + small/decorative embedded
 *                                     images; text stays local. Content-bearing
 *                                     figures (graphs, shaded regions) are
 *                                     NOT this tier — see CONTENT_FIGURE_AREA_RATIO.
 *   - "cloud-page"                 — formula/table/scan/encoding/content-figures;
 *                                     the whole page is rasterized and sent to
 *                                     vision. Vision already emits `[Figura: …]`
 *                                     inline — one call per page beats N crops.
 *
 * Design principle (see 01-diseno-pipeline-tiered.md §1): correctness of
 * grounding beats savings. Thresholds default conservative — prefer a false
 * positive (an easy page goes to Haiku unnecessarily) over a false negative
 * (garbled formula text sneaking into the tutor's material as ground truth).
 *
 * ## formulaScore formula (documented per spec requirement)
 *
 * `formulaScore = clamp01(0.5 * normalizeFontHits(mathFontHits)
 *                        + 0.3 * mathUnicodeRatio
 *                        + 0.2 * fragmentationRatio)`
 *
 * where `normalizeFontHits(hits) = min(1, hits / MATH_FONT_HITS_SATURATION)`
 * and `MATH_FONT_HITS_SATURATION = 5` — five glyphs drawn with a math font
 * is already an unambiguous signal that the page has formulas; more hits
 * shouldn't move the needle further, so we saturate rather than let a
 * formula-dense page dominate the other two terms.
 *
 * The math-font signal gets the largest weight (0.5) because it's the most
 * reliable of the three (§3b of the design doc): a page either uses a math
 * font or it doesn't, there's no ambiguity. Unicode density (0.3) is a good
 * secondary signal but common in prose too (Greek letters in a biology
 * text, arrows in a diagram caption), so it can't dominate alone.
 * Fragmentation (0.2) is the weakest/noisiest signal (short text runs can
 * also come from justified prose, footnotes, or a table of contents) so it
 * gets the smallest weight — it should only tip the score, never carry it.
 * The formula is monotonic in each input, which is all the spec requires.
 */

import { computeStableColumnClusters } from "./geometry";
import type { ImageItem, NormalizedPage, TextItem } from "./types";

export interface Thresholds {
  /** Largest single image covers >= this fraction of page area => scanned. */
  scannedAreaRatio: number;
  /** formulaScore >= this => page goes to the cloud. */
  formulaScore: number;
  /** tableScore >= this => page goes to the cloud. */
  tableScore: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  scannedAreaRatio: 0.8,
  formulaScore: 0.15,
  tableScore: 0.6,
};

/**
 * When the largest embedded image covers >= this fraction of the page, the
 * figure is treated as pedagogical CONTENT (3D surfaces, shaded regions),
 * not decoration — route the whole page to cloud vision instead of keeping
 * local text and silently discarding the images.
 *
 * Measured gap (NOT calibrated — only 2 decorative samples; needs more):
 *   calculo-multivariable: area 0.137–0.691, ~67 chars/page → CONTENT
 *   guia_docente_quimica:  area 0.002–0.089, ~1906 chars/page → decorative
 * Cut at 0.12 sits in that gap. Sparse Tier-0 text co-occurs with content
 * figures on the measured samples; area alone separates them today.
 *
 * Cost: pages that used to be free now pay ~US$0.0007 each (vision). For
 * calculo-multivariable ≈ 22 × 0.0007 ≈ US$0.015. Grounding > savings.
 */
export const CONTENT_FIGURE_AREA_RATIO = 0.12;

/**
 * Companion to CONTENT_FIGURE_AREA_RATIO: Tier-0 character count below which
 * a page with a large figure is "almost only the figure". Measured content
 * pages sit ~57–104 chars; decorative text-heavy pages sit ~1900+. Used
 * together with the area cut so a large decorative banner on a text-rich
 * page does not force a paid cloud round-trip.
 *
 * Mid-gap placeholder — same "needs more samples" caveat as the area cut.
 */
export const CONTENT_FIGURE_SPARSE_TEXT_CHARS = 300;

export type PageRoute =
  | { kind: "local-text" }
  | {
      kind: "cloud-page";
      reason: "scanned" | "formula" | "table" | "encoding" | "figures";
    }
  | { kind: "local-text-with-figures"; figures: ImageItem[] };

export interface PageClassification {
  pageNumber: number;
  route: PageRoute;
  /** Exposed (not just used internally) for the founder-mode processing report. */
  formulaScore: number;
  tableScore: number;
  signals: {
    mathFontHits: number;
    mathUnicodeRatio: number;
    fragmentationRatio: number;
    ruledGrid: boolean;
    columnClusters: number;
    largestImageAreaRatio: number;
    /** True when Tier-0 text would silently corrupt accents/math glyphs. */
    suspiciousEncoding: boolean;
  };
}

/** Math font families (design doc §3b): Computer Modern math + common TeX/MathML fonts. */
const MATH_FONT_RE =
  /CMMI|CMSY|CMEX|MathJax|STIX|XITS|Asana|Latin ?Modern ?Math|Euler/i;

/** Five math-font hits already saturate the normalized font-hit term to 1. */
const MATH_FONT_HITS_SATURATION = 5;

/** Unicode ranges that are overwhelmingly math notation, not prose. */
const MATH_UNICODE_RANGES: Array<[number, number]> = [
  [0x2200, 0x22ff], // Mathematical Operators (∀∃∫∑√∞±≤≥≠ etc.)
  [0x2190, 0x21ff], // Arrows (→← etc.)
  [0x0370, 0x03ff], // Greek and Coptic
  [0x1d400, 0x1d7ff], // Mathematical Alphanumeric Symbols
];

/**
 * A handful of loose math symbols that fall outside the ranges above
 * (design doc §3b calls these out explicitly, e.g. ± is U+00B1, in Latin-1
 * Supplement, not in any math block).
 */
const MATH_EXTRA_CHARS = new Set<number>([0x00b1 /* ± */]);

function isMathCodePoint(cp: number): boolean {
  if (MATH_EXTRA_CHARS.has(cp)) return true;
  for (const [lo, hi] of MATH_UNICODE_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function computeMathFontHits(textItems: TextItem[]): number {
  return textItems.filter((t) => MATH_FONT_RE.test(t.fontName)).length;
}

function computeMathUnicodeRatio(textItems: TextItem[]): number {
  let mathChars = 0;
  let totalChars = 0;
  for (const item of textItems) {
    for (const ch of item.str) {
      totalChars += 1;
      const cp = ch.codePointAt(0);
      if (cp !== undefined && isMathCodePoint(cp)) mathChars += 1;
    }
  }
  return totalChars === 0 ? 0 : mathChars / totalChars;
}

function computeFragmentationRatio(textItems: TextItem[]): number {
  if (textItems.length === 0) return 0;
  const fragments = textItems.filter((t) => t.str.trim().length <= 2).length;
  return fragments / textItems.length;
}

function computeFormulaScore(
  mathFontHits: number,
  mathUnicodeRatio: number,
  fragmentationRatio: number,
): number {
  const normalizedFontHits = Math.min(
    1,
    mathFontHits / MATH_FONT_HITS_SATURATION,
  );
  return clamp01(
    0.5 * normalizedFontHits + 0.3 * mathUnicodeRatio + 0.2 * fragmentationRatio,
  );
}

function computeRuledGrid(page: NormalizedPage): boolean {
  return page.paths.horizontalSegments >= 3 && page.paths.verticalSegments >= 3;
}

/**
 * Borderless-table signal from design doc §3c: count of stable INTERIOR
 * columns (leftmost item of each row excluded — see geometry.ts).
 */
function computeColumnClusters(textItems: TextItem[]): number {
  return computeStableColumnClusters(textItems, { excludeLeftmost: true })
    .length;
}

function computeTableScore(ruledGrid: boolean, columnClusters: number): number {
  if (ruledGrid) return 1;
  return Math.min(1, columnClusters / 4);
}

function computeLargestImageAreaRatio(page: NormalizedPage): number {
  if (page.images.length === 0) return 0;
  const pageArea = page.width * page.height;
  if (pageArea <= 0) return 0;
  const largest = page.images.reduce(
    (max, img) => Math.max(max, img.width * img.height),
    0,
  );
  return largest / pageArea;
}

function countTextChars(textItems: TextItem[]): number {
  let n = 0;
  for (const item of textItems) n += item.str.length;
  return n;
}

/**
 * True when embedded images are the pedagogical payload: large enough to
 * cross CONTENT_FIGURE_AREA_RATIO and Tier-0 text is sparse. Exported for
 * mutation-tested unit coverage of the two borders without opening a PDF.
 */
export function pageHasContentBearingFigures(
  largestImageAreaRatio: number,
  textCharCount: number,
  areaCut: number = CONTENT_FIGURE_AREA_RATIO,
  sparseTextChars: number = CONTENT_FIGURE_SPARSE_TEXT_CHARS,
): boolean {
  return largestImageAreaRatio >= areaCut && textCharCount < sparseTextChars;
}

/**
 * Minimum Private Use Area codepoints before we treat them as encoding
 * corruption. A single U+F0xx dingbat/copyright (common in slide decks)
 * is cosmetic; dozens replacing `|` bars (guiaINEC2) are not.
 */
const MIN_PUA_FOR_SUSPICION = 3;

/**
 * English-looking corrupted possessive: `Instructorís` where the PDF meant
 * `Instructor's`. Requires ≥5 Latin letters before `ís` so short Spanish
 * words like `país` / `anís` do not trip it.
 */
const CORRUPTED_APOSTROPHE_RE = /\b[A-Za-z]{5,}ís\b/;

/**
 * Detect silent Tier-0 corruption that looks like valid Unicode (no U+FFFD,
 * no Latin-1 mojibake) but is wrong for the tutor:
 *   - spacing acute/tilde/diaeresis (`C ´ ALCULO`, `soluci´on`, `compa˜nia`)
 *   - Private Use Area dumps (broken math bars → U+F8F1…)
 *   - C0 control chars from math fonts (Θ/Ω → \x02/\x03)
 *   - `…ís` standing in for `…'s`
 */
export function hasSuspiciousEncoding(textItems: TextItem[]): boolean {
  let puaCount = 0;
  let assembled = "";

  for (const item of textItems) {
    const s = item.str;
    assembled += s;
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      // Spacing/detached accents — precomposed áéíóú never hit these.
      if (cp === 0x00b4 /* ´ */ || cp === 0x02dc /* ˜ */ || cp === 0x00a8 /* ¨ */) {
        return true;
      }
      // C0 controls except TAB/LF/CR.
      if (
        (cp >= 0x00 && cp <= 0x08) ||
        cp === 0x0b ||
        cp === 0x0c ||
        (cp >= 0x0e && cp <= 0x1f)
      ) {
        return true;
      }
      if (cp >= 0xe000 && cp <= 0xf8ff) {
        puaCount += 1;
        if (puaCount >= MIN_PUA_FOR_SUSPICION) return true;
      }
    }
  }

  return CORRUPTED_APOSTROPHE_RE.test(assembled);
}

export function classifyPage(
  page: NormalizedPage,
  t: Thresholds = DEFAULT_THRESHOLDS,
): PageClassification {
  const mathFontHits = computeMathFontHits(page.textItems);
  const mathUnicodeRatio = computeMathUnicodeRatio(page.textItems);
  const fragmentationRatio = computeFragmentationRatio(page.textItems);
  const formulaScore = computeFormulaScore(
    mathFontHits,
    mathUnicodeRatio,
    fragmentationRatio,
  );

  const ruledGrid = computeRuledGrid(page);
  const columnClusters = computeColumnClusters(page.textItems);
  const tableScore = computeTableScore(ruledGrid, columnClusters);

  const largestImageAreaRatio = computeLargestImageAreaRatio(page);
  const suspiciousEncoding = hasSuspiciousEncoding(page.textItems);

  const signals = {
    mathFontHits,
    mathUnicodeRatio,
    fragmentationRatio,
    ruledGrid,
    columnClusters,
    largestImageAreaRatio,
    suspiciousEncoding,
  };

  // Routing tree, in the specified order (03-fase-1-nucleo-deteccion.md),
  // plus encoding as a silent-corruption gate that fires even when
  // formulaScore sits just under its threshold (guiaVA3 p2).
  // 1. Full-page scan.
  if (largestImageAreaRatio >= t.scannedAreaRatio) {
    return {
      pageNumber: page.pageNumber,
      route: { kind: "cloud-page", reason: "scanned" },
      formulaScore,
      tableScore,
      signals,
    };
  }

  // 2. Formula and/or table above threshold => cloud, reason = whichever
  // score exceeds its own threshold by the larger margin.
  const formulaExceeds = formulaScore >= t.formulaScore;
  const tableExceeds = tableScore >= t.tableScore;
  if (formulaExceeds || tableExceeds) {
    let reason: "formula" | "table";
    if (formulaExceeds && tableExceeds) {
      const formulaMargin = formulaScore - t.formulaScore;
      const tableMargin = tableScore - t.tableScore;
      reason = formulaMargin >= tableMargin ? "formula" : "table";
    } else {
      reason = formulaExceeds ? "formula" : "table";
    }
    return {
      pageNumber: page.pageNumber,
      route: { kind: "cloud-page", reason },
      formulaScore,
      tableScore,
      signals,
    };
  }

  // 2b. Suspicious encoding — force cloud even with low formulaScore.
  // Checked after formula/table so those more-specific reasons win when
  // both apply; encoding is the residual silent-corruption net.
  if (suspiciousEncoding) {
    return {
      pageNumber: page.pageNumber,
      route: { kind: "cloud-page", reason: "encoding" },
      formulaScore,
      tableScore,
      signals,
    };
  }

  // 3. Embedded figures: content-bearing (large + sparse text) → cloud
  //    vision for the whole page; small/decorative → local text only.
  if (page.images.length > 0) {
    const textCharCount = countTextChars(page.textItems);
    if (pageHasContentBearingFigures(largestImageAreaRatio, textCharCount)) {
      return {
        pageNumber: page.pageNumber,
        route: { kind: "cloud-page", reason: "figures" },
        formulaScore,
        tableScore,
        signals,
      };
    }
    return {
      pageNumber: page.pageNumber,
      route: { kind: "local-text-with-figures", figures: page.images },
      formulaScore,
      tableScore,
      signals,
    };
  }

  // 4. Clean digital text, nothing else.
  return {
    pageNumber: page.pageNumber,
    route: { kind: "local-text" },
    formulaScore,
    tableScore,
    signals,
  };
}
