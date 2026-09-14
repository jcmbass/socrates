/**
 * Content-bearing figures → cloud-page — measured on real docs/ PDFs.
 *
 * Threshold (NOT calibrated — only 2 decorative samples; needs more):
 *   calculo-multivariable: area 0.137–0.691, ~67 chars → CONTENT → cloud
 *   guia_docente_quimica:  area 0.002–0.089, ~1906 chars → decorative → local
 *
 * Zero paid APIs — parse + classify only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyPage, DEFAULT_THRESHOLDS } from "@buxo/pdf/classify";
import { pageTextToMarkdown } from "@buxo/pdf/pageText";
import { parsePdfNode } from "../../src/pdf/parse-node";

const CALCULO = new URL("../../../../docs/calculo-multivariable.pdf", import.meta.url);
const QUIMICA = new URL("../../../../docs/guia_docente_quimica_general.pdf", import.meta.url);

describe("content-bearing figures route (real PDFs)", () => {
  it("calculo-multivariable: pages that were local-text-with-figures now go cloud figures", async () => {
    const bytes = new Uint8Array(readFileSync(CALCULO));
    const parsed = await parsePdfNode(bytes);
    expect(parsed.numPages).toBe(32);

    const classified = parsed.pages.map((p) => {
      const c = classifyPage(p, DEFAULT_THRESHOLDS);
      return {
        page: p.pageNumber,
        kind: c.route.kind,
        reason: c.route.kind === "cloud-page" ? c.route.reason : null,
        area: c.signals.largestImageAreaRatio,
        chars: pageTextToMarkdown(p).trim().length,
        images: p.images.length,
      };
    });

    const figuresCloud = classified.filter((r) => r.kind === "cloud-page" && r.reason === "figures");
    const stillLtwf = classified.filter((r) => r.kind === "local-text-with-figures");

    // Before: 22 local-text-with-figures discarding 84 images. After: those
    // content pages route to cloud-page figures (none left as ltwf with big images).
    expect(figuresCloud.length).toBeGreaterThanOrEqual(20);
    expect(stillLtwf.length).toBe(0);

    for (const r of figuresCloud) {
      expect(r.area).toBeGreaterThanOrEqual(0.12);
      expect(r.chars).toBeLessThan(300);
    }
  });

  it("guia_docente_quimica: decorative figures do NOT route to cloud figures", async () => {
    const bytes = new Uint8Array(readFileSync(QUIMICA));
    const parsed = await parsePdfNode(bytes);
    expect(parsed.numPages).toBe(12);

    const classified = parsed.pages.map((p) => {
      const c = classifyPage(p, DEFAULT_THRESHOLDS);
      return {
        page: p.pageNumber,
        kind: c.route.kind,
        reason: c.route.kind === "cloud-page" ? c.route.reason : null,
        area: c.signals.largestImageAreaRatio,
      };
    });

    const figuresCloud = classified.filter((r) => r.kind === "cloud-page" && r.reason === "figures");
    expect(figuresCloud).toEqual([]);

    // Decorative pages with images stay local-text-with-figures (or already
    // cloud for table/formula — never figures).
    const withImages = parsed.pages.filter((p) => p.images.length > 0);
    expect(withImages.length).toBeGreaterThan(0);
    for (const p of withImages) {
      const c = classifyPage(p, DEFAULT_THRESHOLDS);
      if (c.route.kind === "cloud-page") {
        expect(c.route.reason).not.toBe("figures");
      }
      expect(c.signals.largestImageAreaRatio).toBeLessThan(0.12);
    }
  });
});
