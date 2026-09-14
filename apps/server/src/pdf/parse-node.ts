/**
 * Node-native PDF parsing — the server-side "capa de I/O" that
 * `especificaciones/C-cliente-e-ingesta.md` §3.2 says needs rewriting when
 * rasterization moves server-side ("solo la capa de I/O se reescribe"),
 * paired with the VERBATIM-ported pure core in this directory
 * (classify.ts/pageText.ts/assemble.ts — see types.ts's docblock).
 *
 * Mirrors `apps/harness/lib/pdf/parse.ts`'s text/operator-list extraction
 * (same affine-matrix bookkeeping, same font-family resolution via
 * `textContent.styles`) but against `pdfjs-dist`'s **legacy Node build**
 * (`pdfjs-dist/legacy/build/pdf.mjs`) instead of the browser build — no
 * `document`, no `Worker`, no `<canvas>` anywhere in this module. Confirmed
 * working against `docs/guia1.pdf` in the F2 WQ1 Part 0 spike (see the Part
 * 1 commit body for the verdict).
 *
 * DEVIATION (scoped, documented): unlike `parse.ts`, this module does NOT
 * extract embedded-figure PIXEL bytes (`extractImageBytes`'s Node
 * equivalent) — only their bounding boxes (needed for `classify.ts`'s
 * scanned-page/figure-count signals). `docs/guia1.pdf`, the mandated F2 WQ1
 * fixture, has zero embedded images on any of its 3 pages (verified via the
 * Part 0 spike's operator-list walk), so this gap is untested territory by
 * necessity, not neglect. `../materials/pipeline.ts` degrades a
 * `local-text-with-figures` page's individual figures to an honest
 * "not transcribed" marker rather than attempting extraction — content-
 * bearing figures now route to `cloud-page` (`CONTENT_FIGURE_AREA_RATIO`)
 * so vision covers them; decorative leftovers stay local-text-only.
 * Full parity with `orchestrate.ts`'s figure-crop transcription is
 * obsolete for the content case (one page vision call emits `[Figura:…]`).
 *
 * Rasterizing a whole page to PNG (the cloud-page tier) is NOT this
 * module's job either — that's `../raster/rasterizer.ts` (needs a canvas
 * implementation; this module only needs `getTextContent`/
 * `getOperatorList`, neither of which touches a canvas).
 */
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { pdfjsNodeDocumentOptions } from "./pdfjs-options";
import type { ImageItem, NormalizedPage, PathStat, TextItem } from "@buxo/pdf/types";
import type { OutlineEntry } from "@buxo/pdf/toc";

/** Below this many page units (~1/72in) a path's extent counts as "zero" — a line, not a rectangle. Mirrors parse.ts's PATH_EPSILON. */
const PATH_EPSILON = 0.5;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function composeMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

interface Bbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boundingBoxOfCorners(ctm: Matrix, corners: Array<[number, number]>): Bbox {
  const transformed = corners.map(([x, y]) => applyMatrix(ctm, x, y));
  const xs = transformed.map((p) => p[0]);
  const ys = transformed.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function unitSquareBbox(ctm: Matrix): Bbox {
  return boundingBoxOfCorners(ctm, [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]);
}

function classifyPathBbox(bbox: Bbox, paths: PathStat): void {
  const w = Math.abs(bbox.width);
  const h = Math.abs(bbox.height);
  if (w < PATH_EPSILON && h < PATH_EPSILON) return;
  if (h < PATH_EPSILON) {
    paths.horizontalSegments += 1;
  } else if (w < PATH_EPSILON) {
    paths.verticalSegments += 1;
  } else {
    paths.rectangles += 1;
  }
}

interface OperatorListLike {
  fnArray: number[];
  argsArray: unknown[];
}

/** Bounding boxes only — no pixel bytes (see module doc DEVIATION). */
function walkOperatorListForBboxes(operatorList: OperatorListLike): { images: ImageItem[]; paths: PathStat } {
  const images: ImageItem[] = [];
  const paths: PathStat = { horizontalSegments: 0, verticalSegments: 0, rectangles: 0 };
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  let inlineCounter = 0;

  const { fnArray, argsArray } = operatorList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;

    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        ctm = stack.pop() ?? IDENTITY;
        break;
      case OPS.transform:
        if (args) ctm = composeMatrix(ctm, args as Matrix);
        break;
      case OPS.paintImageXObject: {
        if (!args) break;
        const objId = args[0] as string;
        images.push({ id: objId, ...unitSquareBbox(ctm) });
        break;
      }
      case OPS.paintImageMaskXObject: {
        if (!args) break;
        const maskArg = args[0] as { data: string };
        images.push({ id: maskArg.data, ...unitSquareBbox(ctm) });
        break;
      }
      case OPS.paintInlineImageXObject: {
        if (!args) break;
        const id = `inline-node-${inlineCounter++}`;
        images.push({ id, ...unitSquareBbox(ctm) });
        break;
      }
      case OPS.constructPath: {
        if (!args) break;
        const minMax = args[2] as [number, number, number, number] | null;
        if (!minMax) break;
        const [lx0, ly0, lx1, ly1] = minMax;
        const bbox = boundingBoxOfCorners(ctm, [
          [lx0, ly0],
          [lx1, ly0],
          [lx0, ly1],
          [lx1, ly1],
        ]);
        classifyPathBbox(bbox, paths);
        break;
      }
      default:
        break;
    }
  }

  return { images, paths };
}

async function normalizePageNode(page: PDFPageProxy): Promise<NormalizedPage> {
  const [x0, y0, x1, y1] = page.view;
  const width = x1 - x0;
  const height = y1 - y0;

  const textContent = await page.getTextContent();
  const textItems: TextItem[] = [];
  for (const item of textContent.items) {
    if (!("str" in item)) continue;
    const style = textContent.styles[item.fontName];
    textItems.push({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      height: item.height,
      fontName: style?.fontFamily ?? item.fontName,
    });
  }

  const operatorList = await page.getOperatorList();
  const { images, paths } = walkOperatorListForBboxes(operatorList);

  return { pageNumber: page.pageNumber, width, height, textItems, images, paths };
}

export interface ParsedPdfNode {
  numPages: number;
  pages: NormalizedPage[];
  /**
   * Flattened bookmark tree with destinations resolved to 1-based page
   * numbers. Broken destinations are omitted (common in real PDFs) — never
   * aborts the parse. Empty when the PDF has no outline.
   *
   * Shape matches `@buxo/pdf/toc`'s `OutlineEntry` so callers can hand it
   * straight to `outlineToTocLocator` (docs/plan-temario-indice).
   */
  outline: OutlineEntry[];
}

/** pdf.js outline node — only the fields we need; `items` recurse. */
interface PdfOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: PdfOutlineNode[];
}

/**
 * Resolves a pdf.js outline destination to a 1-based page number.
 * Returns `null` on missing/broken dests — callers must degrade that entry,
 * not throw (real PDFs ship dangling destinations routinely).
 */
async function resolveOutlinePageNumber(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null,
): Promise<number | null> {
  if (dest == null) return null;
  try {
    let explicit: unknown[] | null;
    if (typeof dest === "string") {
      explicit = await doc.getDestination(dest);
    } else if (Array.isArray(dest)) {
      explicit = dest;
    } else {
      return null;
    }
    if (!explicit || explicit.length === 0) return null;
    const ref = explicit[0];
    if (ref == null || (typeof ref !== "object" && typeof ref !== "string")) return null;
    const pageIndex = await doc.getPageIndex(ref as { num: number; gen: number });
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
    return pageIndex + 1;
  } catch {
    return null;
  }
}

/**
 * Walks `doc.getOutline()` depth-first into a flat `OutlineEntry[]`.
 * Top-level bookmarks are level 1 (matches the fixtures under
 * `packages/pdf/__tests__/__fixtures__/toc/`). Unresolvable destinations
 * are skipped; their children are still walked.
 */
async function extractOutline(doc: PDFDocumentProxy): Promise<OutlineEntry[]> {
  let root: PdfOutlineNode[] | null;
  try {
    root = (await doc.getOutline()) as PdfOutlineNode[] | null;
  } catch {
    return [];
  }
  if (!root || root.length === 0) return [];

  const entries: OutlineEntry[] = [];

  async function walk(nodes: PdfOutlineNode[], level: number): Promise<void> {
    for (const node of nodes) {
      const pageNumber = await resolveOutlinePageNumber(doc, node.dest);
      if (pageNumber !== null) {
        entries.push({ level, title: node.title ?? "", pageNumber });
      }
      if (node.items && node.items.length > 0) {
        await walk(node.items, level + 1);
      }
    }
  }

  await walk(root, 1);
  return entries;
}

export type PdfjsDocumentOptionsOverride = {
  data: Uint8Array;
  disableFontFace: true;
  standardFontDataUrl?: string;
};

export interface ParsePdfNodeOptions {
  /**
   * Test/measurement only (beta-real 09 P6): pass `{ data, disableFontFace: true }`
   * WITHOUT `standardFontDataUrl` to compare classification before/after the
   * font fix. Production callers must omit this.
   */
  documentOptionsOverride?: PdfjsDocumentOptionsOverride;
  /**
   * 1-based page numbers to normalize. `undefined` (default) = every page.
   * `[]` = none — returns `numPages` + `outline` only (used by the large-PDF
   * book-index path to peek without parsing 400+ pages).
   */
  pageNumbers?: number[];
}

function isDocumentOptionsOverride(arg: unknown): arg is PdfjsDocumentOptionsOverride {
  return (
    typeof arg === "object" &&
    arg !== null &&
    "data" in arg &&
    "disableFontFace" in arg &&
    !("pageNumbers" in arg) &&
    !("documentOptionsOverride" in arg)
  );
}

/**
 * Parses pages of `bytes` into `NormalizedPage[]` — text content +
 * path/image bounding boxes, no rendering — plus the resolved bookmark
 * outline. This IS what the materials pipeline (`../materials/pipeline.ts`)
 * feeds to `classify.ts` for server-side re-classification (risk #2: the
 * server never trusts the client's classification, it re-derives it from
 * these same bytes).
 *
 * `disableFontFace: true` (matches `parse.ts`'s SPIKE F0.5 mitigation,
 * `ParsePdfOptions.disableFontFace`'s docblock) — Node has no `document.fonts`
 * at all, so this is not optional here the way it was an opt-in tunable on
 * the client; pdf.js's own path-based glyph fallback is the only option
 * server-side, and it never affects `getTextContent()`/`getOperatorList()`
 * output (font-face conversion only matters for rendering).
 *
 * `bytes.slice()` (not `bytes` directly): pdf.js's Node "fake worker"
 * treats `getDocument({ data })`'s buffer as transferable and DETACHES it
 * after use — see `../raster/rasterizer.ts`'s module doc for the full
 * repro. The materials pipeline calls this function AND
 * `RasterizerService.rasterizePage` against the same uploaded PDF's bytes;
 * without the copy, whichever of those two runs second would throw a
 * confusing `DataCloneError` on an already-detached buffer.
 *
 * Second argument accepts either `ParsePdfNodeOptions` or the legacy
 * bare `PdfjsDocumentOptionsOverride` (kept so
 * `__tests__/pdf/standard-fonts-delta.test.ts` stays unchanged).
 */
export async function parsePdfNode(
  bytes: Uint8Array,
  optionsOrOverride?: ParsePdfNodeOptions | PdfjsDocumentOptionsOverride,
): Promise<ParsedPdfNode> {
  const options: ParsePdfNodeOptions = isDocumentOptionsOverride(optionsOrOverride)
    ? { documentOptionsOverride: optionsOrOverride }
    : (optionsOrOverride ?? {});

  const opts = options.documentOptionsOverride ?? pdfjsNodeDocumentOptions(bytes);
  const doc: PDFDocumentProxy = await getDocument(opts).promise;
  const outline = await extractOutline(doc);

  const pageNumbers =
    options.pageNumbers !== undefined
      ? options.pageNumbers
      : Array.from({ length: doc.numPages }, (_, i) => i + 1);

  const pages: NormalizedPage[] = [];
  for (const pageNumber of pageNumbers) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) continue;
    const page = await doc.getPage(pageNumber);
    pages.push(await normalizePageNode(page));
  }
  return { numPages: doc.numPages, pages, outline };
}
