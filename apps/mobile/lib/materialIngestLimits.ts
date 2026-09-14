/**
 * Client mirror of `apps/server/src/raster/limits.ts`'s
 * `MAX_PAGES_PER_REQUEST` — kept in sync by hand (same package-boundary
 * discipline as `apps/harness/lib/ingest/limits.ts`).
 *
 * Bounds the **subset** WebView path (one cloud page field per page). When
 * the PDF has more pages, the client uploads the whole file
 * (`uploadMaterialFull`) and the server decides — book-index digest or
 * `MaterialTooLargeError` if no index is found.
 */
export const MAX_PAGES_PER_REQUEST = 20;

/**
 * Materials upload + server-side digest can take far longer than a warm
 * tutor exchange: up to `MAX_PAGES_PER_REQUEST × RASTER_TIMEOUT_MS` of
 * raster work alone (~400s) plus transcription. A 30s warm timeout would
 * turn a real progress bar into an elegant failure (plan §4).
 */
export const MATERIALS_UPLOAD_TIMEOUT_MS = 420_000;

/**
 * Above this binary size, skip the WebView bridge entirely and upload the
 * whole PDF for server-side classify+digest (`digestMaterialPdf`).
 *
 * beta-real 08: posting ~20 MB of base64 through `postMessage` OOMs a
 * 1.87 GB phone before the server ever sees the file. 3 MB binary ≈ 4 MB
 * base64 is already a heavy bridge payload; the failing fixture is 15.5 MB.
 */
export const CLIENT_WEBVIEW_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Max wait for the first WebView progress/result/fatal after postMessage.
 * Generous for a normal PDF on a slow device; finite so a hung bridge is
 * never a mute permanent busy state (beta-real 08 Fase 2).
 */
export const WEBVIEW_PARSE_TIMEOUT_MS = 90_000;

/** True when the PDF should skip on-device parse and go straight to full upload. */
export function shouldSkipWebViewParse(sizeBytes: number, maxBytes: number = CLIENT_WEBVIEW_MAX_BYTES): boolean {
  return sizeBytes > maxBytes;
}
