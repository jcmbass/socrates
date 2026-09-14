/// <reference lib="dom" />
/// <reference lib="webworker" />
/**
 * Material ingest WebView driver — PRODUCTION (F2 WQ2 Part 2), promoted
 * from the SPIKE F0.5 pattern (`spike-f05/webview-src/entry.ts`, kept
 * intact and still working — see that file's own docblock). Bundled to a
 * single self-contained ESM string by `../build.mjs` (esbuild) and loaded
 * as a hidden `<WebView source={{ html }}>` — see
 * `components/MaterialIngestBar.tsx`.
 *
 * REUSE, not rewrite (LECCIONES-Y-BUGS pattern 5 + architect mandate):
 * imports `parsePdf` straight from `apps/harness/lib/pdf/parse.ts` and
 * `classifyPage`/`DEFAULT_THRESHOLDS`/`pageTextToMarkdown` from the shared
 * `@buxo/pdf` package (F2 WQ2 Part 0a) — UNMODIFIED. What this file adds:
 * (a) the postMessage bridge, (b) per-cloud-page single-page PDF
 * extraction via `pdf-lib` (browser-safe, no Node built-ins — verified via
 * an esbuild browser-target bundle smoke check during this wave), (c) the
 * Worker-spawn patch (identical technique to the spike, see that file's
 * "WHY THE WORKER GETS PATCHED" docblock section for the full reasoning —
 * not repeated here).
 *
 * WHAT THIS DRIVER NEVER DOES: call any model/transcription API. Unlike
 * the spike (which mocked `transcribe` locally, §0 point 4 of the spike
 * spec), production has NO client-side transcription step at all — cloud
 * pages are just split into single-page PDFs and uploaded; the SAME
 * request that uploads them (`POST /v1/materials?mode=subset`, F2 WQ2
 * Part 1) does the real (or fake-in-tests) transcription server-side.
 * Tier-0 text for local pages is extracted here (pdf.js, $0, on-device)
 * and uploaded as TEXT, never as page bytes — the plan's explicit privacy
 * note: "text leaves the device only as part of the material the student
 * explicitly submitted".
 */
import { parsePdf } from "../../../harness/lib/pdf/parse";
import { classifyPage, DEFAULT_THRESHOLDS } from "@buxo/pdf/classify";
import { pageTextToMarkdown } from "@buxo/pdf/pageText";
import { PDFDocument } from "pdf-lib";
import type {
  HostToWebMessage,
  IngestCloudPage,
  IngestManifestEntry,
  IngestResult,
  WebToHostMessage,
} from "../../lib/materialIngestBridge";

// Injected by materials/build.mjs via esbuild `define` — the esbuild-bundled
// text of apps/harness/lib/pdf/worker-entry.ts (polyfill + real pdf.js
// worker), so the Worker patch below can spawn it from a same-origin
// `blob:` URL with zero network fetch. Identical mechanism to the spike.
declare const __WORKER_BUNDLE_SOURCE__: string;

// ---------------------------------------------------------------------------
// Bridge out (WebView -> RN host)
// ---------------------------------------------------------------------------

interface RNWebViewBridge {
  postMessage: (data: string) => void;
}
declare global {
  interface Window {
    ReactNativeWebView?: RNWebViewBridge;
  }
}

function post(msg: WebToHostMessage): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
}

// ---------------------------------------------------------------------------
// Worker patch — see this file's docblock and the spike's for the full
// "why" (Turbopack/webpack statically splits `new Worker(new URL(...))`
// into a fetchable chunk; a WebView loaded via `source={{ html }}` has no
// real origin to fetch that chunk FROM, so the spawn is redirected to a
// same-origin blob: URL containing the real worker bundle instead).
// ---------------------------------------------------------------------------
function installWorkerPatch(): void {
  if (typeof Worker === "undefined") return;
  const OriginalWorker = Worker;
  const blobUrl = URL.createObjectURL(new Blob([__WORKER_BUNDLE_SOURCE__], { type: "application/javascript" }));
  class PatchedWorker extends OriginalWorker {
    constructor(_scriptURL: string | URL, options?: WorkerOptions) {
      super(blobUrl, options);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional global override, see docblock
  (window as any).Worker = PatchedWorker;
}
installWorkerPatch();

// ---------------------------------------------------------------------------
// Base64 <-> bytes (postMessage only carries strings)
// ---------------------------------------------------------------------------

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000; // avoid a single giant String.fromCharCode(...spread) call
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Main ingest run
// ---------------------------------------------------------------------------

async function runIngest(msg: HostToWebMessage): Promise<void> {
  try {
    const bytes = base64ToUint8Array(msg.pdfBase64);
    const file = new File([bytes as unknown as BlobPart], msg.fileName, { type: "application/pdf" });

    const parsed = await parsePdf(file);
    const totalPages = parsed.pages.length;

    // Independent PDFDocument load for pdf-lib's page-extraction (pdf.js
    // and pdf-lib each own their own parse of the bytes — no shared state,
    // same "no cross-library object reuse" discipline the server's raster
    // pipeline documents, see apps/server/src/raster/rasterizer.ts).
    const srcDoc = await PDFDocument.load(bytes);

    const manifest: IngestManifestEntry[] = [];
    const cloudPages: IngestCloudPage[] = [];

    for (const page of parsed.pages) {
      const classification = classifyPage(page, DEFAULT_THRESHOLDS);
      post({ type: "progress", requestId: msg.requestId, page: page.pageNumber, total: totalPages, routeKind: classification.route.kind });

      if (classification.route.kind === "cloud-page") {
        const out = await PDFDocument.create();
        const [copied] = await out.copyPages(srcDoc, [page.pageNumber - 1]);
        out.addPage(copied);
        const singlePageBytes = await out.save();
        cloudPages.push({ pageNumber: page.pageNumber, base64: uint8ArrayToBase64(singlePageBytes) });
        manifest.push({ pageNumber: page.pageNumber, claimedTier: "cloud", localText: null });
      } else {
        // local-text | local-text-with-figures — Tier-0 text stays on
        // device except as TEXT in the manifest (never page bytes), per
        // the plan's privacy note.
        manifest.push({ pageNumber: page.pageNumber, claimedTier: "local", localText: pageTextToMarkdown(page) });
      }
    }

    const result: IngestResult = { fileName: msg.fileName, totalPages, manifest, cloudPages };
    post({ type: "result", requestId: msg.requestId, result });
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    post({ type: "fatal", requestId: msg.requestId, message });
  }
}

// ---------------------------------------------------------------------------
// Host -> WebView message listener
// ---------------------------------------------------------------------------

function handleRawHostMessage(raw: unknown): void {
  if (typeof raw !== "string") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (isHostIngestMessage(parsed)) void runIngest(parsed);
}

function isHostIngestMessage(x: unknown): x is HostToWebMessage {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as { type?: unknown }).type === "ingest" &&
    typeof (x as { requestId?: unknown }).requestId === "string" &&
    typeof (x as { fileName?: unknown }).fileName === "string" &&
    typeof (x as { pdfBase64?: unknown }).pdfBase64 === "string"
  );
}

// Android WebView historically dispatches postMessage events on `document`;
// some engines/versions use `window` instead — listen on both (cheap,
// idempotent: only one will ever actually fire per platform). Same pattern
// as the spike.
document.addEventListener("message", (e: Event) => handleRawHostMessage((e as MessageEvent).data));
window.addEventListener("message", (e: Event) => handleRawHostMessage((e as MessageEvent).data));
