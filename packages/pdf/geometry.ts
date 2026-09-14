/**
 * Shared page-geometry helpers for the pure PDF core.
 *
 * Used by `classify.ts` (borderless-table column signal) and `pageText.ts`
 * (column-aware reading order). Kept free of pdf.js / DOM / network — same
 * package invariant as the rest of `@buxo/pdf`.
 */

import type { TextItem } from "./types";

/** Tolerance (page units) for grouping text items into the same row. */
export const ROW_Y_TOLERANCE = 3;
/** Tolerance (page units) for bucketing x positions into the same column. */
export const COLUMN_X_TOLERANCE = 5;
/** A column must recur in at least this many distinct rows to count. */
export const MIN_ROWS_PER_COLUMN = 3;

/**
 * Group text items into rows by y proximity (top-to-bottom). Y grows upward
 * in PDF coordinates, so descending y is reading order within a column.
 */
export function groupTextItemsIntoRows(textItems: TextItem[]): TextItem[][] {
  if (textItems.length === 0) return [];
  const sorted = [...textItems].sort((a, b) => b.y - a.y);
  const rows: TextItem[][] = [];
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - item.y) <= ROW_Y_TOLERANCE);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows;
}

export interface ColumnCluster {
  x: number;
  rowIndexes: Set<number>;
}

/**
 * Clusters text-item x positions into columns and returns those that recur
 * across >= MIN_ROWS_PER_COLUMN rows.
 *
 * When `excludeLeftmost` is true (table signal), each row's own leftmost
 * item is skipped before clustering — left-justified prose trivially shares
 * a left margin, and counting it would make ordinary paragraphs register as
 * a "column". Reading-order detection leaves leftmost in (excludeLeftmost
 * false) so both sides of a two-column layout are visible as clusters.
 */
export function computeStableColumnClusters(
  textItems: TextItem[],
  options: { excludeLeftmost: boolean } = { excludeLeftmost: true },
): ColumnCluster[] {
  if (textItems.length === 0) return [];

  const rows = groupTextItemsIntoRows(textItems);
  const columns: ColumnCluster[] = [];

  rows.forEach((row, rowIndex) => {
    const ordered = [...row].sort((a, b) => a.x - b.x);
    const items = options.excludeLeftmost ? ordered.slice(1) : ordered;
    for (const item of items) {
      let column = columns.find(
        (c) => Math.abs(c.x - item.x) <= COLUMN_X_TOLERANCE,
      );
      if (!column) {
        column = { x: item.x, rowIndexes: new Set() };
        columns.push(column);
      }
      column.rowIndexes.add(rowIndex);
    }
  });

  return columns.filter((c) => c.rowIndexes.size >= MIN_ROWS_PER_COLUMN);
}
