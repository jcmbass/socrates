/**
 * Normalized page representation (docs/plan-local-litert fase 1).
 *
 * This is the ONLY shape the pure detection/assembly core in `lib/pdf/`
 * ever sees. It has zero knowledge of pdf.js, the DOM, or the network — a
 * thin glue layer (fase 3, client-side) parses a real PDF with pdf.js and
 * produces this representation; everything downstream of it (classify,
 * assemble, pageText) is pure and exhaustively testable with synthetic
 * fixtures instead of real PDFs.
 */

/** A single positioned text run, as pdf.js's `getTextContent()` would yield. */
export interface TextItem {
  str: string;
  /** Origin of the run in page coordinates. Y grows upward (PDF convention). */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * The REAL font family name (e.g. "CMMI10", "STIXGeneral") — NOT a pdf.js
   * internal alias like "g_d0_f1". The glue layer must resolve this from the
   * page's font resources; classify.ts's math-font signal depends on it.
   */
  fontName: string;
}

/** A discrete embedded raster image, as extracted from the operator list. */
export interface ImageItem {
  /** Stable reference to the extracted image bytes (consumed in fase 2/3). */
  id: string;
  /** Bounding box, bottom-left corner, in page coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pre-aggregated vector-path statistics for a page, computed by the glue
 * layer from the raw operator list (constructPath / stroke / fill /
 * rectangle ops). Used to detect ruled tables without relying on any
 * discrete "table" object, which PDFs don't have.
 */
export interface PathStat {
  /** Count of axis-aligned, roughly-horizontal line segments. */
  horizontalSegments: number;
  /** Count of axis-aligned, roughly-vertical line segments. */
  verticalSegments: number;
  rectangles: number;
}

export interface NormalizedPage {
  /** 1-based page number. */
  pageNumber: number;
  width: number;
  height: number;
  textItems: TextItem[];
  images: ImageItem[];
  paths: PathStat;
}
