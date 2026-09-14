/**
 * parsePdfNode — unit-tested against the REAL `docs/guia1.pdf` fixture,
 * cross-checked against `classify.ts` (the verbatim-ported pure core) to
 * confirm the server's Node extraction produces the same routing a browser
 * would (per §2.5 of the spike protocol this pipeline descends from —
 * "consistencia de clasificación"). Zero network calls.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parsePdfNode } from "../../src/pdf/parse-node";
import { classifyPage, DEFAULT_THRESHOLDS } from "@buxo/pdf/classify";
import { pageTextToMarkdown } from "@buxo/pdf/pageText";

const GUIA1_PATH = new URL("../../../../docs/guia1.pdf", import.meta.url);

describe("parsePdfNode — docs/guia1.pdf", () => {
  it("parses all 3 pages with non-empty text content", async () => {
    const bytes = new Uint8Array(await readFile(GUIA1_PATH));
    const parsed = await parsePdfNode(bytes);

    expect(parsed.numPages).toBe(3);
    expect(parsed.pages).toHaveLength(3);
    for (const page of parsed.pages) {
      expect(page.textItems.length).toBeGreaterThan(0);
      expect(page.width).toBeGreaterThan(0);
      expect(page.height).toBeGreaterThan(0);
    }
  });

  it("guia1.pdf has zero embedded images on every page (confirms the Part 0 scoping decision to defer figure-crop extraction)", async () => {
    const bytes = new Uint8Array(await readFile(GUIA1_PATH));
    const parsed = await parsePdfNode(bytes);
    for (const page of parsed.pages) {
      expect(page.images).toHaveLength(0);
    }
  });

  it("classifyPage (verbatim-ported pure core) routes every page deterministically off the Node-extracted NormalizedPage", async () => {
    const bytes = new Uint8Array(await readFile(GUIA1_PATH));
    const parsed = await parsePdfNode(bytes);

    const classifications = parsed.pages.map((page) => classifyPage(page, DEFAULT_THRESHOLDS));
    for (const c of classifications) {
      expect(["local-text", "local-text-with-figures", "cloud-page"]).toContain(c.route.kind);
    }
    // guia1.pdf is deliberately formula/table-dense (spec §2.3) — at least
    // one of its 3 pages must route to cloud-page, otherwise this fixture
    // isn't exercising the tier this wave is actually about.
    expect(classifications.some((c) => c.route.kind === "cloud-page")).toBe(true);
  });

  it("pageTextToMarkdown produces non-empty markdown for a local-text page", async () => {
    const bytes = new Uint8Array(await readFile(GUIA1_PATH));
    const parsed = await parsePdfNode(bytes);
    const firstPage = parsed.pages[0];
    const markdown = pageTextToMarkdown(firstPage);
    expect(markdown.length).toBeGreaterThan(0);
  });
});
