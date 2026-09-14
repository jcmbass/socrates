/**
 * reclassifyUploadedPdf — server-side re-classification against the REAL
 * `docs/guia1.pdf` fixture (risk #2: never trust the client's claimed
 * tier). Zero model calls — pdf.js text/operator-list extraction only.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { reclassifyUploadedPdf } from "../../src/materials/reclassify";

const GUIA1_PATH = new URL("../../../../docs/guia1.pdf", import.meta.url);

describe("reclassifyUploadedPdf — docs/guia1.pdf", () => {
  it("re-derives a route for every page independent of any client claim", async () => {
    const bytes = new Uint8Array(await readFile(GUIA1_PATH));
    const result = await reclassifyUploadedPdf(bytes);

    expect(result.numPages).toBe(3);
    expect(result.pages).toHaveLength(3);
    for (const page of result.pages) {
      expect(["local-text", "local-text-with-figures", "cloud-page"]).toContain(page.route.kind);
    }
  });

  it("extracts server-side text for local-tier pages at $0, and leaves cloud-tier pages for the rasterizer/transcriber", async () => {
    const bytes = new Uint8Array(await readFile(GUIA1_PATH));
    const result = await reclassifyUploadedPdf(bytes);

    for (const page of result.pages) {
      if (page.route.kind === "cloud-page") {
        expect(page.localText).toBeNull();
      } else {
        expect(page.localText).not.toBeNull();
        expect((page.localText as string).length).toBeGreaterThan(0);
      }
    }

    // guia1.pdf (formula/table-dense per spec §2.3) must produce at least
    // one cloud-page — otherwise this fixture isn't exercising Tier-2 at all.
    expect(result.pages.some((p) => p.route.kind === "cloud-page")).toBe(true);
  });
});
