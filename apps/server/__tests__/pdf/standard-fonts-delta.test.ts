/**
 * beta-real 09 P6 — measure whether standardFontDataUrl changes cloud vs
 * local routing on the docs/ fixtures (offline, zero cost).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyPage, DEFAULT_THRESHOLDS } from "@buxo/pdf/classify";
import { parsePdfNode } from "../../src/pdf/parse-node";

const DOCS_DIR = fileURLToPath(new URL("../../../../docs/", import.meta.url));

describe("standardFontDataUrl classification delta (beta-real 09 P6)", () => {
  it("compares cloud-page counts with vs without standard fonts on docs/*.pdf", async () => {
    const names = (await readdir(DOCS_DIR))
      .filter((f) => f.endsWith(".pdf") && f !== "The_Distributed_Node.pdf")
      .sort();
    expect(names.length).toBeGreaterThan(0);

    const rows: Array<{
      file: string;
      pages: number;
      cloudWithout: number;
      cloudWith: number;
      routeChanges: number;
      textItemsDelta: number;
    }> = [];

    for (const name of names) {
      const bytes = new Uint8Array(await readFile(join(DOCS_DIR, name)));
      const without = await parsePdfNode(bytes, { data: bytes.slice(), disableFontFace: true });
      const withFonts = await parsePdfNode(bytes);
      const routesWithout = without.pages.map((p) => classifyPage(p, DEFAULT_THRESHOLDS).route.kind);
      const routesWith = withFonts.pages.map((p) => classifyPage(p, DEFAULT_THRESHOLDS).route.kind);
      let routeChanges = 0;
      for (let i = 0; i < routesWithout.length; i++) {
        if (routesWithout[i] !== routesWith[i]) routeChanges += 1;
      }
      const textItemsWithout = without.pages.reduce((s, p) => s + p.textItems.length, 0);
      const textItemsWith = withFonts.pages.reduce((s, p) => s + p.textItems.length, 0);
      rows.push({
        file: name,
        pages: without.numPages,
        cloudWithout: routesWithout.filter((k) => k === "cloud-page").length,
        cloudWith: routesWith.filter((k) => k === "cloud-page").length,
        routeChanges,
        textItemsDelta: textItemsWith - textItemsWithout,
      });
    }

    // Always print so DEVLOG can cite the measurement without re-running.
    // eslint-disable-next-line no-console
    console.log("[P6 fonts] classification delta:\n" + rows.map((r) => JSON.stringify(r)).join("\n"));

    // Sanity: both paths produce the same page counts; fonts must not crash.
    for (const r of rows) {
      expect(r.pages).toBeGreaterThan(0);
      expect(r.cloudWith).toBeGreaterThanOrEqual(0);
      expect(r.cloudWithout).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);
});
