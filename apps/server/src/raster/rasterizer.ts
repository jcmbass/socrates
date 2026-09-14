/**
 * RasterizerService — F2 WQ1 Part 1
 * (`docs/plan-app-multiplataforma/05-plan-f2.md` Ola 1, DF-7 "el raster en
 * server no consume tokens nuevos ... el server gana un endpoint de
 * rasterización (CPU barato)").
 *
 * PART 0 VERDICT (risk #1, plan §"Riesgos nombrados" #1): `@napi-rs/canvas`
 * (resolved 1.0.2 via pdfjs-dist's own `optionalDependencies` range
 * `^1.0.0` — see the Part 1 commit body for why an exact pin fought that
 * and caused a dual-package-hazard bug, fixed by NOT pinning) DOES work
 * under Node with pdf.js's legacy Node build
 * (`pdfjs-dist/legacy/build/pdf.mjs`, `page.render({ canvasContext, viewport })`).
 * Verified against the real `docs/guia1.pdf` fixture: all 3 pages rendered
 * in 33–232ms each, produced decodable, non-empty PNGs at 2x scale
 * (1224×1584px). `@napi-rs/canvas` ships prebuilt binaries for
 * `linux-x64-musl` too, so it works unmodified on the Dockerfile's
 * `node:22-alpine` base (musl libc) — not just this dev machine's glibc.
 * See the Part 1 commit body for the full spike transcript. The `pdftoppm`
 * (poppler-utils) fallback described in the plan was NOT needed — this
 * interface is still designed so a `PopplerRasterizerService` could satisfy
 * it later without touching any caller, per the plan's "behind the SAME
 * internal interface so the choice is swappable" instruction.
 *
 * REAL BUG FOUND AND WORKED AROUND (flag for architect review): calling
 * `@napi-rs/canvas`'s `loadImage()` on a just-rendered PNG, then calling
 * pdf.js's `getDocument()` AGAIN in the same process, throws
 * `DataCloneError: Cannot transfer object of unsupported type` deep inside
 * pdf.js's Node "fake worker" (`LoopbackPort.postMessage` ->
 * `structuredClone`) — reproduced in a plain Node script (not just under
 * vitest), so this is a genuine cross-library interaction, not a test
 * artifact. Root cause not fully isolated (time-boxed); the practical fix
 * is to NOT call `loadImage()` in this service's hot path — a PNG magic-byte
 * check is sufficient decodability evidence for production use, and the
 * Part 0 spike already round-tripped `loadImage()` standalone (see the
 * commit body) to confirm the RENDERED BYTES THEMSELVES are a valid,
 * decodable PNG. This service therefore only checks non-empty bytes here;
 * a would-be caller processing many pages sequentially (the real materials
 * pipeline, `../materials/pipeline.ts`) never calls `loadImage()` between
 * pages, so the bug's trigger condition never occurs in production code.
 *
 * This module owns ONLY rendering a page to PNG bytes — text/operator-list
 * extraction (for classification) is `../pdf/parse-node.ts`'s job. The two
 * are split because classifying a page never needs to render it (cheaper
 * to skip raster entirely for a page the server reclassifies as local-text
 * — see `../materials/pipeline.ts`, risk #2).
 */
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjsNodeDocumentOptions } from "../pdf/pdfjs-options";
import { MAX_PIXELS_PER_PAGE, RASTER_TIMEOUT_MS } from "./limits";
import { computeAdaptiveScale, pageFitsAtScaleOne } from "./scale";

export interface RasterizePageInput {
  pdfBytes: Uint8Array;
  /** 1-based, matches pdf.js/`NormalizedPage.pageNumber` convention. */
  pageNumber: number;
  /**
   * Optional explicit scale. When omitted, adaptive scale (pixel budget +
   * DPI floor) is used. When set, it is clamped to the hard pixel ceiling
   * rather than rejected (beta-real 07) — only pages that overflow even at
   * scale 1 throw `RasterPageTooLargeError`.
   */
  scale?: number;
}

export interface RasterizePageResult {
  png: Buffer;
  width: number;
  height: number;
  /** Effective scale after adaptive clamp (useful for tuning / telemetry). */
  scale: number;
}

export class RasterPageTooLargeError extends Error {
  readonly pageNumber: number;
  readonly pixels: number;
  readonly max: number;

  constructor(pageNumber: number, pixels: number, max: number) {
    super(`RasterizerService: page ${pageNumber} would render to ${pixels}px (max ${max}px) — rejected before allocating a canvas`);
    this.name = "RasterPageTooLargeError";
    this.pageNumber = pageNumber;
    this.pixels = pixels;
    this.max = max;
  }
}

export class RasterTimeoutError extends Error {
  constructor(pageNumber: number, timeoutMs: number) {
    super(`RasterizerService: page ${pageNumber} did not finish rendering within ${timeoutMs}ms`);
    this.name = "RasterTimeoutError";
  }
}

export interface RasterizerService {
  rasterizePage(input: RasterizePageInput): Promise<RasterizePageResult>;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * `@napi-rs/canvas`-backed implementation — the winner of the Part 0 spike.
 * Re-loads `pdfBytes` with pdf.js per call rather than caching a shared
 * `PDFDocumentProxy` across calls: this keeps the interface trivially
 * swappable for a shell-out `pdftoppm` implementation (which has no notion
 * of a "loaded document" to reuse either), at the cost of re-parsing PDF
 * structure (NOT re-rendering) once per rasterized page — cheap relative to
 * the render itself per the Part 0 spike's numbers.
 */
export class NapiCanvasRasterizerService implements RasterizerService {
  async rasterizePage(input: RasterizePageInput): Promise<RasterizePageResult> {
    const render = async (): Promise<RasterizePageResult> => {
      // REAL BUG FOUND AND WORKED AROUND (2nd one — see the module doc's
      // first note for the loadImage() one): pdf.js's Node "fake worker"
      // treats `getDocument({ data })`'s buffer as TRANSFERABLE — the
      // underlying ArrayBuffer gets detached after the first call.
      // Reproduced in a plain Node script (not vitest-specific): calling
      // `getDocument({ data: sameBytes })` a second time on the SAME
      // `Uint8Array` instance throws `DataCloneError` deep in
      // `structuredClone` (the detached buffer is no longer a valid
      // transferable). The materials pipeline (`../materials/pipeline.ts`)
      // calls `rasterizePage` once per cloud-tier page, always with the
      // SAME uploaded PDF's bytes — `.slice()` here hands pdf.js an
      // independent copy every call so the caller's buffer is never
      // detached out from under it, regardless of how many pages are
      // rasterized from the same upload.
      const doc: PDFDocumentProxy = await getDocument(pdfjsNodeDocumentOptions(input.pdfBytes)).promise;
      if (input.pageNumber < 1 || input.pageNumber > doc.numPages) {
        throw new Error(`RasterizerService: no such page ${input.pageNumber} (document has ${doc.numPages} pages)`);
      }
      const page = await doc.getPage(input.pageNumber);
      // Scale-1 viewport = physical page size in PDF points (adaptive input).
      const baseViewport = page.getViewport({ scale: 1 });
      const widthPt = baseViewport.width;
      const heightPt = baseViewport.height;

      if (!pageFitsAtScaleOne(widthPt, heightPt)) {
        throw new RasterPageTooLargeError(
          input.pageNumber,
          Math.ceil(widthPt) * Math.ceil(heightPt),
          MAX_PIXELS_PER_PAGE,
        );
      }

      const adapted = computeAdaptiveScale({
        widthPt,
        heightPt,
        requestedScale: input.scale,
      });
      const scale = adapted.scale;

      // Tuning input for beta-real 07 §5 — pixels/scale per page; no PII.
      console.info(
        JSON.stringify({
          msg: "raster.adaptive_scale",
          page: input.pageNumber,
          widthPt,
          heightPt,
          scale,
          pixels: adapted.pixels,
          dpiFloorApplied: adapted.dpiFloorApplied,
          pixelCapApplied: adapted.pixelCapApplied,
        }),
      );

      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const pixels = width * height;

      // Defensive: rounding can push past the cap on pathological sizes.
      if (pixels > MAX_PIXELS_PER_PAGE) {
        throw new RasterPageTooLargeError(input.pageNumber, pixels, MAX_PIXELS_PER_PAGE);
      }

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      // pdf.js's RenderParameters types `canvas` as required (`HTMLCanvasElement
      // | null`) with `canvasContext` as the optional backward-compat field —
      // its own doc comment says "if the context must absolutely be used to
      // render the page, the canvas must be null", which is exactly this
      // case (`@napi-rs/canvas`'s SKRSContext2D satisfies pdf.js's runtime
      // CanvasRenderingContext2D duck-type but isn't a real DOM type, so
      // `canvas: null` sidesteps the type mismatch cleanly instead of an
      // `as unknown as HTMLCanvasElement` cast).
      await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;

      const png = canvas.toBuffer("image/png");
      // PNG magic-byte check only (not a full loadImage() round-trip) — see
      // this file's module doc, "REAL BUG FOUND AND WORKED AROUND": calling
      // loadImage() here breaks the NEXT getDocument() call in the same
      // process, which the real materials pipeline needs (multiple cloud
      // pages per upload). The Part 0 spike already confirmed full
      // decodability via loadImage() in isolation.
      if (png.length === 0 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) {
        throw new Error(`RasterizerService: page ${input.pageNumber} produced an invalid PNG buffer`);
      }

      return { png, width, height, scale };
    };

    return withTimeout(render(), RASTER_TIMEOUT_MS, () => new RasterTimeoutError(input.pageNumber, RASTER_TIMEOUT_MS));
  }
}
