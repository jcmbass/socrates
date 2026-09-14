/**
 * beta-real 09 P6 — standardFontDataUrl is wired and offline-measurable.
 */
import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pdfjsNodeDocumentOptions, pdfjsStandardFontDataUrl } from "../../src/pdf/pdfjs-options";

describe("pdfjs-options — standardFontDataUrl (beta-real 09 P6)", () => {
  it("resolves to an existing standard_fonts directory under pdfjs-dist", async () => {
    const dir = pdfjsStandardFontDataUrl();
    expect(dir.endsWith("/") || dir.endsWith("\\")).toBe(true);
    expect(dir.startsWith("file:")).toBe(false);
    await access(dir);
    await access(join(dir, "LiberationSans-Regular.ttf"));
  });

  it("pdfjsNodeDocumentOptions includes the path and copies the buffer", () => {
    const original = new Uint8Array([1, 2, 3]);
    const opts = pdfjsNodeDocumentOptions(original);
    expect(opts.standardFontDataUrl).toBe(pdfjsStandardFontDataUrl());
    expect(opts.disableFontFace).toBe(true);
    expect(opts.isEvalSupported).toBe(false);
    expect(opts.enableScripting).toBe(false);
    expect(opts.data).not.toBe(original);
    expect(Array.from(opts.data)).toEqual([1, 2, 3]);
  });
});
