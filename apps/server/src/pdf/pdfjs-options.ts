/**
 * Resolve pdf.js standard font data for Node (beta-real 09 P6).
 *
 * Without `standardFontDataUrl`, pdf.js logs
 * `UnknownErrorException: Ensure that the standardFontDataUrl API parameter
 * is provided` and falls back when mapping glyphs — some text pages can be
 * under-extracted and mis-classified as cloud-page (paid) when local would
 * have been enough.
 *
 * The fonts ship inside `pdfjs-dist/standard_fonts/`. Node's
 * `NodeBinaryDataFactory` loads them via `fs.readFile(url)` — so this must
 * be a **filesystem path** with a trailing separator, NOT a `file://` URL
 * (that fails with "Unable to load font data at: file://…").
 */
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";

const require = createRequire(import.meta.url);

/** Absolute path to `pdfjs-dist/standard_fonts/` (trailing sep). */
export function pdfjsStandardFontDataUrl(): string {
  const pkgJson = require.resolve("pdfjs-dist/package.json");
  return join(dirname(pkgJson), "standard_fonts") + sep;
}

/** Shared `getDocument` options for server-side pdf.js (parse + raster). */
export function pdfjsNodeDocumentOptions(data: Uint8Array): {
  data: Uint8Array;
  disableFontFace: true;
  isEvalSupported: false;
  enableScripting: false;
  standardFontDataUrl: string;
} {
  return {
    // `.slice()` — pdf.js's Node fake-worker detaches the buffer (see
    // rasterizer / parse-node module docs).
    data: data.slice(),
    disableFontFace: true,
    isEvalSupported: false,
    enableScripting: false,
    standardFontDataUrl: pdfjsStandardFontDataUrl(),
  };
}
