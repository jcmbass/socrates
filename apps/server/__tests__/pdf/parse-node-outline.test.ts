/**
 * parsePdfNode outline + selective page parse — plan-temario-indice wiring.
 * Offline: real docs/ PDFs, zero model calls.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parsePdfNode } from "../../src/pdf/parse-node";
import { outlineToTocLocator } from "@buxo/pdf/toc";

const GUIA1_PATH = new URL("../../../../docs/guia1.pdf", import.meta.url);
const PROSA_BIO_PATH = new URL("../../../../docs/prosa-bio.pdf", import.meta.url);
const CORMEN_PATH = new URL("../../../../docs/introduction-to-algorithms-cormen-solution-2nd.pdf", import.meta.url);

describe("parsePdfNode — outline", () => {
  it("returns an empty outline for docs/guia1.pdf (no bookmarks)", async () => {
    const bytes = new Uint8Array(await readFile(GUIA1_PATH));
    const parsed = await parsePdfNode(bytes);
    expect(parsed.outline).toEqual([]);
  });

  it("pageNumbers: [] returns numPages + outline without normalizing pages", async () => {
    const bytes = new Uint8Array(await readFile(PROSA_BIO_PATH));
    const parsed = await parsePdfNode(bytes, { pageNumbers: [] });
    expect(parsed.numPages).toBe(1);
    expect(parsed.pages).toEqual([]);
  });

  it("introduction-to-algorithms outline locates Contents at page 3 (not bare Chapter N as temario)", async () => {
    const bytes = new Uint8Array(await readFile(CORMEN_PATH));
    const parsed = await parsePdfNode(bytes, { pageNumbers: [] });
    expect(parsed.numPages).toBe(429);
    expect(parsed.pages).toEqual([]);
    expect(parsed.outline.length).toBeGreaterThan(0);

    const contents = parsed.outline.find((e) => /^contents$/i.test(e.title.trim()));
    expect(contents).toBeDefined();
    expect(contents!.pageNumber).toBe(3);

    // Bare chapter markers still exist in the outline — they are the LOCATOR
    // tree, not the temario source. outlineToTocLocator must prefer Contents.
    expect(parsed.outline.some((e) => /^Chapter \d+$/.test(e.title.trim()))).toBe(true);
    expect(outlineToTocLocator(parsed.outline)).toEqual({
      kind: "toc-page",
      pageNumber: 3,
      matchedTitle: contents!.title.trim(),
    });
  });

  it("pageNumbers selects only the requested pages (Cormen pages 3–4)", async () => {
    const bytes = new Uint8Array(await readFile(CORMEN_PATH));
    const parsed = await parsePdfNode(bytes, { pageNumbers: [3, 4] });
    expect(parsed.numPages).toBe(429);
    expect(parsed.pages.map((p) => p.pageNumber)).toEqual([3, 4]);
    expect(parsed.pages.every((p) => p.textItems.length > 0)).toBe(true);
  });
});
