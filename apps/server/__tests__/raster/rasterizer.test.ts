/**
 * RasterizerService — unit-tested against the REAL `docs/guia1.pdf` fixture
 * (F2 WQ1 Part 1) + adaptive-scale cases from beta-real 07.
 * Zero model-API calls — pdf.js + @napi-rs/canvas only, entirely local.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import {
  NapiCanvasRasterizerService,
  RasterPageTooLargeError,
  RasterTimeoutError,
  type RasterizerService,
} from "../../src/raster/rasterizer";
import { MAX_PIXELS_PER_PAGE, MIN_RASTER_DPI, PDF_POINTS_PER_INCH } from "../../src/raster/limits";

const GUIA1_PATH = new URL("../../../../docs/guia1.pdf", import.meta.url);
const DISTRIBUTED_NODE_PATH = new URL("../../../../docs/The_Distributed_Node.pdf", import.meta.url);

async function loadGuia1(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(GUIA1_PATH));
}

describe("NapiCanvasRasterizerService.rasterizePage — docs/guia1.pdf", () => {
  it("rasterizes every one of guia1.pdf's 3 pages to a decodable, non-empty PNG", async () => {
    const bytes = await loadGuia1();
    const rasterizer: RasterizerService = new NapiCanvasRasterizerService();

    for (const pageNumber of [1, 2, 3]) {
      const result = await rasterizer.rasterizePage({ pdfBytes: bytes, pageNumber });
      expect(result.png.length).toBeGreaterThan(0);
      // PNG magic bytes — a real decodable image, not an empty/garbage buffer.
      expect(result.png[0]).toBe(0x89);
      expect(result.png[1]).toBe(0x50);
      expect(result.png[2]).toBe(0x4e);
      expect(result.png[3]).toBe(0x47);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.scale).toBeGreaterThan(0);
      expect(result.width * result.height).toBeLessThanOrEqual(MAX_PIXELS_PER_PAGE);
    }
  });

  it("adaptive default scale lands near the pixel budget (not a fixed 2×)", async () => {
    const bytes = await loadGuia1();
    const rasterizer = new NapiCanvasRasterizerService();

    const at1x = await rasterizer.rasterizePage({ pdfBytes: bytes, pageNumber: 1, scale: 1 });
    const adaptive = await rasterizer.rasterizePage({ pdfBytes: bytes, pageNumber: 1 });

    expect(adaptive.width).toBeGreaterThan(at1x.width);
    expect(adaptive.height).toBeGreaterThan(at1x.height);
    // Letter-ish page: adaptive ≈ 1.76, not the old hard-coded 2.
    expect(adaptive.scale).toBeGreaterThan(1.5);
    expect(adaptive.scale).toBeLessThan(2.1);
    expect(adaptive.width * adaptive.height).toBeLessThanOrEqual(MAX_PIXELS_PER_PAGE);
  });

  it("clamps an absurd requested scale instead of rejecting a normal page", async () => {
    const bytes = await loadGuia1();
    const rasterizer = new NapiCanvasRasterizerService();
    const result = await rasterizer.rasterizePage({ pdfBytes: bytes, pageNumber: 1, scale: 100 });
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_PIXELS_PER_PAGE);
    expect(result.scale).toBeLessThan(100);
  });

  it("rejects a page number outside the document's range", async () => {
    const bytes = await loadGuia1();
    const rasterizer = new NapiCanvasRasterizerService();
    await expect(rasterizer.rasterizePage({ pdfBytes: bytes, pageNumber: 99 })).rejects.toThrow(/no such page/);
  });

  it("rejects only pages that overflow MAX_PIXELS even at scale 1", async () => {
    const doc = await PDFDocument.create();
    // 3000×3000 pt → 9M px at scale 1 > 4M hard cap.
    doc.addPage([3000, 3000]);
    const bytes = new Uint8Array(await doc.save());
    const rasterizer = new NapiCanvasRasterizerService();
    await expect(rasterizer.rasterizePage({ pdfBytes: bytes, pageNumber: 1 })).rejects.toThrow(RasterPageTooLargeError);
  });
});

describe("NapiCanvasRasterizerService — docs/The_Distributed_Node.pdf (beta-real 07)", () => {
  it("rasterizes all 15 panoramic slide pages without RasterPageTooLargeError", async () => {
    const bytes = new Uint8Array(await readFile(DISTRIBUTED_NODE_PATH));
    const rasterizer = new NapiCanvasRasterizerService();

    for (let pageNumber = 1; pageNumber <= 15; pageNumber++) {
      const result = await rasterizer.rasterizePage({ pdfBytes: bytes, pageNumber });
      expect(result.png.length).toBeGreaterThan(0);
      expect(result.width * result.height).toBeLessThanOrEqual(MAX_PIXELS_PER_PAGE);
      // DPI floor: scale ≥ MIN_RASTER_DPI / 72.
      expect(result.scale * PDF_POINTS_PER_INCH).toBeGreaterThanOrEqual(MIN_RASTER_DPI - 0.5);
    }
  }, 120_000);
});

describe("full loadImage() decodability round-trip (isolated — see rasterizer.ts's module doc)", () => {
  // Deliberately its OWN test, run LAST in the file, and never followed by
  // another rasterizePage()/getDocument() call: napi-rs's loadImage()
  // breaks the NEXT pdf.js getDocument() call in the same process (a real
  // bug, reproduced outside vitest too — see rasterizer.ts's "REAL BUG
  // FOUND AND WORKED AROUND" note). This test exists to prove the RENDERED
  // BYTES are genuinely decodable (the Part 0 spike's actual assertion),
  // without tripping that bug for every other test in this file.
  it("a rasterized page's PNG bytes decode via @napi-rs/canvas's own loadImage", async () => {
    const bytes = await loadGuia1();
    const rasterizer = new NapiCanvasRasterizerService();
    const result = await rasterizer.rasterizePage({ pdfBytes: bytes, pageNumber: 1 });

    const decoded = await loadImage(result.png);
    expect(decoded.width).toBe(result.width);
    expect(decoded.height).toBe(result.height);
  });
});

describe("RasterizerService size/timeout error types", () => {
  it("RasterPageTooLargeError and RasterTimeoutError carry actionable messages", () => {
    const tooLarge = new RasterPageTooLargeError(3, 9_000_000, 4_000_000);
    expect(tooLarge.message).toContain("page 3");
    expect(tooLarge.name).toBe("RasterPageTooLargeError");
    expect(tooLarge.pageNumber).toBe(3);
    expect(tooLarge.pixels).toBe(9_000_000);
    expect(tooLarge.max).toBe(4_000_000);

    const timedOut = new RasterTimeoutError(2, 20_000);
    expect(timedOut.message).toContain("page 2");
    expect(timedOut.name).toBe("RasterTimeoutError");
  });
});
