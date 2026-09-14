/**
 * Local (Tier 0, $0) text reconstruction from a normalized page
 * (docs/plan-local-litert §5, fase 1).
 *
 * Deliberately simple and pure: group text items into lines by y
 * proximity, order lines top-to-bottom, join a line's words left-to-right
 * by ascending x, and split paragraphs on large y gaps. When the page has
 * ≥2 stable reading columns (detected via a recurring mid-line gutter —
 * same row-grouping tolerances as `geometry.ts` / `classify.ts`), emit the
 * multi-column band column-by-column (left then right) and keep the
 * full-width bands above/below in ordinary row order. That way two-column
 * exercise sheets keep logical order (1…6 then 7…12) instead of visual
 * interleave (1) 7) / 2) 8) …), without pulling bottom full-width sections
 * into the left column. Ordinary justified prose has no stable gutter and
 * keeps the historical row-wise behavior.
 *
 * No attempt at rich markdown reconstruction (headings, bold, lists) —
 * that's Haiku's job on the hard pages; this module only handles the
 * easy, already-clean case.
 */

import {
  groupTextItemsIntoRows,
  MIN_ROWS_PER_COLUMN,
} from "./geometry";
import type { NormalizedPage, TextItem } from "./types";

/**
 * A y-gap between consecutive lines bigger than this multiple of the
 * previous line's average item height marks a paragraph break. Scales with
 * font size instead of a fixed point value, so it behaves consistently
 * across a page's body text and a differently-sized caption or heading.
 */
const PARAGRAPH_GAP_FACTOR = 1.8;

/**
 * Minimum empty gap (page units) between consecutive items on the same row
 * to count as a candidate column gutter. Ordinary inter-word spacing is
 * far smaller; two-column exercise sheets have gutters of 70–200+.
 */
const MIN_GUTTER_GAP = 40;

/** Gutters whose midpoints fall within this tolerance are the same split. */
const GUTTER_X_TOLERANCE = 25;

/**
 * A candidate split must leave both sides with at least this fraction of
 * the larger side's item count — rejects header-only "columns" where one
 * side is a thin strip of title text.
 */
const MIN_COLUMN_BALANCE = 0.2;

interface Line {
  y: number;
  avgHeight: number;
  text: string;
}

interface ReadingColumns {
  split: number;
  /** Inclusive top of the multi-column band (PDF y grows upward). */
  bandTop: number;
  /** Inclusive bottom of the multi-column band. */
  bandBottom: number;
}

function groupIntoLines(textItems: TextItem[]): Line[] {
  const rawLines = groupTextItemsIntoRows(textItems);

  return rawLines.map((items) => {
    const orderedByX = [...items].sort((a, b) => a.x - b.x);
    const text = orderedByX
      .map((i) => i.str.trim())
      .filter((s) => s.length > 0)
      .join(" ");
    const avgY = items.reduce((sum, i) => sum + i.y, 0) / items.length;
    const avgHeight =
      items.reduce((sum, i) => sum + i.height, 0) / items.length;
    return { y: avgY, avgHeight, text };
  });
}

function linesToMarkdown(lines: Line[]): string {
  const nonEmpty = lines.filter((l) => l.text.length > 0);
  if (nonEmpty.length === 0) return "";

  let markdown = nonEmpty[0].text;
  for (let i = 1; i < nonEmpty.length; i++) {
    const prev = nonEmpty[i - 1];
    const curr = nonEmpty[i];
    const gap = prev.y - curr.y;
    const normalLineHeight = prev.avgHeight || curr.avgHeight || 1;
    const isParagraphBreak = gap > normalLineHeight * PARAGRAPH_GAP_FACTOR;
    markdown += (isParagraphBreak ? "\n\n" : "\n") + curr.text;
  }
  return markdown;
}

function joinMarkdownParts(parts: string[]): string {
  return parts.filter((p) => p.length > 0).join("\n\n");
}

interface GutterCandidate {
  x: number;
  rowsWithGutter: number;
}

/**
 * Find a stable vertical gutter and the vertical band where both columns
 * actually run in parallel. Returns null for single-column pages (justified
 * prose, title pages, etc.).
 *
 * Inspired by `computeStableColumnClusters` in geometry.ts: same row
 * grouping, but looking for a recurring *gap between items* rather than
 * aligned item x-positions (table cells). The winning split maximizes the
 * number of rows that have content on both sides (true parallel columns).
 */
function detectReadingColumns(
  textItems: TextItem[],
  pageWidth: number,
): ReadingColumns | null {
  if (textItems.length === 0 || pageWidth <= 0) return null;

  const rows = groupTextItemsIntoRows(textItems);
  const candidates: GutterCandidate[] = [];

  for (const row of rows) {
    const ordered = [...row].sort((a, b) => a.x - b.x);
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const next = ordered[i];
      const gap = next.x - (prev.x + prev.width);
      if (gap < MIN_GUTTER_GAP) continue;
      const mid = (prev.x + prev.width + next.x) / 2;
      let candidate = candidates.find(
        (c) => Math.abs(c.x - mid) <= GUTTER_X_TOLERANCE,
      );
      if (!candidate) {
        candidate = { x: mid, rowsWithGutter: 0 };
        candidates.push(candidate);
      }
      candidate.rowsWithGutter += 1;
      candidate.x =
        (candidate.x * (candidate.rowsWithGutter - 1) + mid) /
        candidate.rowsWithGutter;
    }
  }

  const bandLo = pageWidth * 0.25;
  const bandHi = pageWidth * 0.75;
  const stable = candidates.filter(
    (c) =>
      c.rowsWithGutter >= MIN_ROWS_PER_COLUMN &&
      c.x >= bandLo &&
      c.x <= bandHi,
  );
  if (stable.length === 0) return null;

  let best: {
    split: number;
    both: number;
    bandTop: number;
    bandBottom: number;
  } | null = null;

  for (const c of stable) {
    const bimodalYs: number[] = [];
    for (const row of rows) {
      const hasLeft = row.some((i) => i.x < c.x);
      const hasRight = row.some((i) => i.x >= c.x);
      if (hasLeft && hasRight) {
        const avgY = row.reduce((sum, i) => sum + i.y, 0) / row.length;
        bimodalYs.push(avgY);
      }
    }
    if (bimodalYs.length < MIN_ROWS_PER_COLUMN) continue;

    const leftCount = textItems.filter((i) => i.x < c.x).length;
    const rightCount = textItems.filter((i) => i.x >= c.x).length;
    const heavier = Math.max(leftCount, rightCount);
    const lighter = Math.min(leftCount, rightCount);
    if (heavier === 0 || lighter / heavier < MIN_COLUMN_BALANCE) continue;

    const both = bimodalYs.length;
    const bandTop = Math.max(...bimodalYs);
    const bandBottom = Math.min(...bimodalYs);
    if (!best || both > best.both) {
      best = { split: c.x, both, bandTop, bandBottom };
    }
  }

  if (!best) return null;
  return {
    split: best.split,
    bandTop: best.bandTop,
    bandBottom: best.bandBottom,
  };
}

export function pageTextToMarkdown(page: NormalizedPage): string {
  const columns = detectReadingColumns(page.textItems, page.width);
  if (columns === null) {
    return linesToMarkdown(groupIntoLines(page.textItems));
  }

  const { split, bandTop, bandBottom } = columns;
  const above: TextItem[] = [];
  const below: TextItem[] = [];
  const left: TextItem[] = [];
  const right: TextItem[] = [];

  for (const item of page.textItems) {
    if (item.y > bandTop) {
      above.push(item);
    } else if (item.y < bandBottom) {
      below.push(item);
    } else if (item.x < split) {
      left.push(item);
    } else {
      right.push(item);
    }
  }

  return joinMarkdownParts([
    linesToMarkdown(groupIntoLines(above)),
    linesToMarkdown(groupIntoLines(left)),
    linesToMarkdown(groupIntoLines(right)),
    linesToMarkdown(groupIntoLines(below)),
  ]);
}
