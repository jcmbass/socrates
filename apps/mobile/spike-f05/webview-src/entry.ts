/// <reference lib="dom" />
/// <reference lib="webworker" />
/**
 * SPIKE F0.5 (ingestion memory gate) — WebView-bridge driver.
 *
 * THROWAWAY CODE, __DEV__-only, per
 * docs/plan-app-multiplataforma/especificaciones/C-cliente-e-ingesta.md §2.
 * This file is NOT part of the product; it (and all of `spike-f05/` +
 * `app/dev/spike-f05.tsx` + `lib/spikeF05Bridge.ts`) gets deleted once the
 * spike's verdict lands (§2.6 step 7). It is never imported by any
 * non-`__DEV__` code path.
 *
 * Runs INSIDE a `react-native-webview` (a real Chromium WebView on
 * Android), loaded via `source={{ html, baseUrl }}` — see
 * `app/dev/spike-f05.tsx`. Bundled to a single self-contained ESM string by
 * `../build.mjs` (esbuild) and inlined as `<script type="module">`, because
 * `source={{ html }}` gives the page no real, fetchable origin to load
 * separate `<script src>` files from.
 *
 * REUSE, not rewrite (per LECCIONES-Y-BUGS pattern 5 + the architect
 * mandate): imports `parsePdf`/`classifyPage`/`DEFAULT_THRESHOLDS`/
 * `ingestPdfTiered` straight from `apps/harness/lib/pdf/`, unmodified. The
 * ONLY thing this file adds on top is (a) the postMessage bridge, (b) the
 * mocked `transcribe` (zero real API calls, §0 point 4), and (c) the
 * Worker-spawn patch documented below.
 *
 * ── WHY THE WORKER GETS PATCHED ──────────────────────────────────────────
 * `lib/pdf/parse.ts`'s `loadPdfjs()` spawns pdf.js's worker via
 * `new Worker(new URL("./worker-entry.ts", import.meta.url), { type:
 * "module" })`. That pattern relies on Turbopack/webpack emitting
 * `worker-entry.ts` as a SEPARATE, independently fetchable chunk next to
 * the main bundle — which only works when the page has a real navigable
 * origin. Our WebView page has no such origin (`source={{ html }}` with a
 * synthetic `baseUrl` so relative `new URL(...)` construction doesn't
 * throw, but nothing is actually servable from that fake origin).
 *
 * Rather than editing `parse.ts` (forbidden — REUSE, don't rewrite; also
 * the whole point of the spike is to test the pipeline AS SHIPPED), this
 * file monkey-patches the global `Worker` constructor before `parsePdf()`
 * is ever called: whatever URL `loadPdfjs()` passes in is ignored, and a
 * `blob:` URL containing the REAL `worker-entry.ts` bundle (built by
 * `../build.mjs`, injected below as `__WORKER_BUNDLE_SOURCE__`) is spawned
 * instead. This still exercises the real thing the spike needs to know —
 * a real `Worker`/`{type:"module"}` spawn in a real mobile WebView, the
 * real pdf.worker.min.mjs geometry code, the real Math.sumPrecise polyfill
 * inside the worker's own global scope (LECCIONES-Y-BUGS 2026-07-11) —
 * only the SOURCE RESOLUTION step is redirected, which is an artifact of
 * "single inline HTML string" packaging, not of the pdf.js pipeline itself.
 * If `Worker` doesn't exist at all, or module workers aren't supported by
 * this WebView, that is exactly the honest signal the spike wants — it is
 * captured and reported (`workerDiagnostics`), never hidden.
 */
import { parsePdf } from "../../../harness/lib/pdf/parse";
import { classifyPage, DEFAULT_THRESHOLDS } from "../../../harness/lib/pdf/classify";
import { ingestPdfTiered } from "../../../harness/lib/pdf/orchestrate";
import type { ParsedPdf, TranscribeResult } from "../../../harness/lib/pdf/orchestrate";
import {
  MOCK_CLOUD_MARKER,
  type BlobDiagnostic,
  type ConsoleEvent,
  type HostToWebMessage,
  type SpikeResult,
  type UnhandledErrorEvent,
  type WebToHostMessage,
  type WorkerDiagnostics,
} from "../../lib/spikeF05Bridge";

// Injected by spike-f05/build.mjs via esbuild `define` — the esbuild-bundled
// text of apps/harness/lib/pdf/worker-entry.ts (polyfill + real
// pdf.worker.min.mjs), so the Worker patch below can spawn it from a
// same-origin blob: URL with zero network fetch.
declare const __WORKER_BUNDLE_SOURCE__: string;

// ---------------------------------------------------------------------------
// Console + unhandled-error capture (re-checks the "silent worker TypeError"
// lesson from LECCIONES-Y-BUGS.md 2026-07-11 — fixed for desktop Chromium,
// unknown for mobile WebView until this spike runs).
// ---------------------------------------------------------------------------

const consoleEvents: ConsoleEvent[] = [];
const unhandledErrors: UnhandledErrorEvent[] = [];

(["log", "info", "warn", "error"] as const).forEach((level) => {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    consoleEvents.push({
      level,
      message: args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ""}` : String(a))).join(" "),
      ts: Date.now(),
    });
    original(...args);
  };
});

window.addEventListener("error", (ev: ErrorEvent) => {
  unhandledErrors.push({ message: ev.message, stack: ev.error?.stack });
});
window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
  const reason = ev.reason as unknown;
  unhandledErrors.push({
    message: `unhandledrejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

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
  const bridge = window.ReactNativeWebView;
  if (bridge) bridge.postMessage(JSON.stringify(msg));
}

function logToHost(level: "log" | "info" | "warn" | "error", message: string): void {
  post({ type: "log", level, message, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// Worker patch (see docblock above)
// ---------------------------------------------------------------------------

const workerDiagnostics: WorkerDiagnostics = {
  workerGlobalAvailable: typeof Worker !== "undefined",
  workerPatchInstalled: false,
  workerConstructionErrors: [],
};

function installWorkerPatch(): void {
  if (typeof Worker === "undefined") {
    logToHost("warn", "SPIKE: `Worker` is undefined in this WebView global — pdf.js will fall back to its fake-worker/main-thread path (not the real worker path this spike wants to exercise).");
    return;
  }
  try {
    const OriginalWorker = Worker;
    const blobUrl = URL.createObjectURL(
      new Blob([__WORKER_BUNDLE_SOURCE__], { type: "application/javascript" }),
    );
    // Deliberate monkeypatch — see docblock. MUST be a real `class ...
    // extends OriginalWorker`, NOT a plain function that `return`s a
    // freshly-constructed OriginalWorker instance: pdf.js's own
    // `GlobalWorkerOptions.workerPort` setter runtime-guards with
    // `instanceof Worker` — resolved against whatever the CURRENT global
    // `Worker` binding is at call time, i.e. our patched class once
    // installed below. A plain-function "return new OriginalWorker(...)"
    // produces an instance whose prototype chain never includes the
    // patched constructor's `.prototype`, so that guard fails with
    // "Invalid `workerPort` type" (caught on-device during this spike's
    // first run — see f05-spike-veredicto.md). Subclassing keeps the
    // prototype chain correct: `new PatchedWorker(...)` IS `instanceof
    // Worker` once `Worker` itself refers to `PatchedWorker`.
    class PatchedWorker extends OriginalWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        logToHost(
          "info",
          `SPIKE: Worker patch intercepted spawn of "${String(scriptURL)}" -> substituting bundled worker-entry.ts via blob: URL (real Worker + {type:"module"} API exercised; only source resolution is redirected — see entry.ts docblock).`,
        );
        try {
          super(blobUrl, options);
        } catch (err) {
          const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
          workerDiagnostics.workerConstructionErrors.push(message);
          throw err;
        }
        // Diagnostic-only (not relied on by pdf.js itself): confirms
        // whether the worker thread ever actually starts executing at all
        // versus silently never spawning — this WebView/Android version
        // combination is untested territory (spec §2.4).
        this.addEventListener("error", (ev: ErrorEvent) => {
          logToHost("error", `SPIKE: worker 'error' event: ${ev.message} (${ev.filename}:${ev.lineno}:${ev.colno})`);
        });
        this.addEventListener("messageerror", () => {
          logToHost("error", "SPIKE: worker 'messageerror' event (structured-clone deserialization failure).");
        });
        let sawFirstMessage = false;
        this.addEventListener("message", () => {
          if (!sawFirstMessage) {
            sawFirstMessage = true;
            logToHost("info", "SPIKE: worker sent its first postMessage back to main thread — worker thread IS executing.");
          }
        });
        setTimeout(() => {
          if (!sawFirstMessage) {
            logToHost(
              "warn",
              "SPIKE: 5s after spawn, the worker has not posted ANY message back yet (no 'error' event either) — likely silently failed to start executing (module worker from blob: URL unsupported on this WebView?) rather than erroring.",
            );
          }
        }, 5000);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional global override, see docblock
    (window as any).Worker = PatchedWorker;
    workerDiagnostics.workerPatchInstalled = true;
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    workerDiagnostics.workerConstructionErrors.push(message);
    logToHost("error", `SPIKE: failed to install Worker patch: ${message}`);
  }
}

installWorkerPatch();

// ---------------------------------------------------------------------------
// Mocked transcribe — §0 point 4 / LECCIONES-Y-BUGS "cero llamadas a la API
// sin aprobación": canned text + artificial delay, NEVER a real fetch.
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pngMagicValid(bytes: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

function makeMockTranscribe(
  blobDiagnostics: BlobDiagnostic[],
): (blob: Blob, mode: "figure" | "page", subject?: string) => Promise<TranscribeResult> {
  return async (blob, mode) => {
    logToHost("info", `SPIKE: mockTranscribe(mode=${mode}, blob.size=${blob.size}) starting...`);
    const t0 = performance.now();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    blobDiagnostics.push({ mode, sizeBytes: blob.size, pngMagicValid: pngMagicValid(bytes) });
    // Artificial network-latency simulation ONLY — no real request of any kind.
    await delay(300 + Math.floor(Math.random() * 400));
    logToHost("info", `SPIKE: mockTranscribe(mode=${mode}) done in ${(performance.now() - t0).toFixed(0)}ms`);
    return {
      text: `${MOCK_CLOUD_MARKER} (mode=${mode}) texto canario fijo de la corrida del spike F0.5 — sin llamada real a la API de transcripción.`,
      cached: false,
      estCostUsd: 0,
    };
  };
}

// ---------------------------------------------------------------------------
// Base64 -> bytes (postMessage only carries strings)
// ---------------------------------------------------------------------------

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// PHASE 3 lever (only reached because Phase 2's iteration 1 run hung for
// >2 minutes rasterizing guia1.pdf page 1 at the default 2x scale — see
// f05-spike-veredicto.md "iteración 1"): `DEFAULT_RASTER_SCALE` was
// already flagged by C-cliente-e-ingesta.md §3.4 as "a candidate to lower
// on low-end, a tunable to validate empirically", and it's the first lever
// listed in this run's Phase 3 instructions. `parsePdf`'s new (additive,
// optional) second argument — added in apps/harness/lib/pdf/parse.ts
// specifically for this — lets the spike override it without touching any
// other pipeline behavior. Bump the iteration number in the log line (and
// the veredicto report) each time this constant changes.
//
// Iteración 1 (rasterScale=1, down from default 2) did NOT resolve the
// hang — still >50s stuck in the same rasterizePage(1) call with zero
// further progress, ruling out raw pixel fill-rate as the bottleneck (a
// 4x-smaller canvas should show SOME improvement if that were it).
// Iteración 2: `disableFontFace: true` — guia1.pdf is LaTeX/MiKTeX with
// dense embedded math fonts, and pdf.js's real-@font-face rendering path
// depends on a `document.fonts`/FontFace round-trip that a WebView with
// partial FontFace API support could plausibly hang on. Both levers are
// applied together now (not reverted one at a time) purely for run-time
// budget in this session — the veredicto report notes this as a
// methodology deviation from "change one lever at a time".
// ---------------------------------------------------------------------------
const PHASE3_RASTER_SCALE = 1; // iteración 1: down from DEFAULT_RASTER_SCALE (2)
const PHASE3_DISABLE_FONT_FACE = true; // iteración 2

// ---------------------------------------------------------------------------
// Diagnostic parse wrapper — REUSES parsePdf unchanged (per §0 point 4 /
// LECCIONES-Y-BUGS pattern 5, never rewrite the reused pipeline); this
// only wraps the closures the pipeline already returns with before/after
// timing logs, to localize exactly which step is slow/hung on-device —
// something a black-box `ingestPdfTiered` call can't surface on its own.
// ---------------------------------------------------------------------------

function instrumentedParse(file: File): Promise<ParsedPdf> {
  logToHost(
    "info",
    `SPIKE: Phase 3 iteración 2 — parsePdf con rasterScale=${PHASE3_RASTER_SCALE} (default 2), disableFontFace=${PHASE3_DISABLE_FONT_FACE} (default false)`,
  );
  return parsePdf(file, { rasterScale: PHASE3_RASTER_SCALE, disableFontFace: PHASE3_DISABLE_FONT_FACE }).then((parsed) => {
    const originalRasterize = parsed.rasterizePage.bind(parsed);
    const originalGetImageBytes = parsed.getImageBytes.bind(parsed);
    return {
      ...parsed,
      rasterizePage: async (pageNumber: number) => {
        logToHost("info", `SPIKE: rasterizePage(${pageNumber}) starting...`);
        const t0 = performance.now();
        try {
          const blob = await originalRasterize(pageNumber);
          logToHost(
            "info",
            `SPIKE: rasterizePage(${pageNumber}) done in ${(performance.now() - t0).toFixed(0)}ms, blob.size=${blob.size}`,
          );
          return blob;
        } catch (err) {
          logToHost("error", `SPIKE: rasterizePage(${pageNumber}) threw after ${(performance.now() - t0).toFixed(0)}ms: ${err instanceof Error ? err.message : String(err)}`);
          throw err;
        }
      },
      getImageBytes: async (pageNumber: number, imageId: string) => {
        logToHost("info", `SPIKE: getImageBytes(${pageNumber}, ${imageId}) starting...`);
        const t0 = performance.now();
        try {
          const blob = await originalGetImageBytes(pageNumber, imageId);
          logToHost("info", `SPIKE: getImageBytes(${pageNumber}, ${imageId}) done in ${(performance.now() - t0).toFixed(0)}ms, blob.size=${blob.size}`);
          return blob;
        } catch (err) {
          logToHost("error", `SPIKE: getImageBytes(${pageNumber}, ${imageId}) threw after ${(performance.now() - t0).toFixed(0)}ms: ${err instanceof Error ? err.message : String(err)}`);
          throw err;
        }
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Main run
// ---------------------------------------------------------------------------

async function runSpike(msg: HostToWebMessage): Promise<void> {
  const startedAt = performance.now();
  const routes: SpikeResult["routes"] = [];
  const blobDiagnostics: BlobDiagnostic[] = [];

  try {
    const bytes = base64ToUint8Array(msg.pdfBase64);
    // Cast: lib.dom's BlobPart typing wants an ArrayBufferView<ArrayBuffer>
    // specifically; our Uint8Array is always backed by a plain ArrayBuffer
    // at runtime (never SharedArrayBuffer — it's freshly allocated by
    // base64ToUint8Array), TS's broader ArrayBufferLike generic just can't
    // prove that statically.
    const file = new File([bytes as unknown as BlobPart], msg.fileName, { type: "application/pdf" });

    logToHost("info", `SPIKE: starting ingestPdfTiered for ${msg.fileName} (${bytes.length} bytes)`);

    const { material, report } = await ingestPdfTiered(
      file,
      undefined,
      { parse: instrumentedParse, transcribe: makeMockTranscribe(blobDiagnostics) },
      (page, total, routeKind) => {
        routes.push({ page, total, routeKind });
        post({ type: "progress", page, total, routeKind });
      },
    );

    const totalElapsedMs = performance.now() - startedAt;

    const result: SpikeResult = {
      fileName: msg.fileName,
      totalElapsedMs,
      routes,
      materialText: material,
      report,
      blobDiagnostics,
      consoleEvents,
      unhandledErrors,
      workerDiagnostics,
    };
    post({ type: "result", result });
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    post({ type: "fatal", message });
  }
}

// Sanity check exposed for classify.ts reuse verification (not otherwise
// used) — keeps DEFAULT_THRESHOLDS/classifyPage imports from being flagged
// as unused if a future edit trims runSpike's direct usage; also lets the
// results panel show the exact thresholds this run used, for the veredicto
// report's classification-consistency row.
function currentThresholdsSnapshot(): typeof DEFAULT_THRESHOLDS {
  return DEFAULT_THRESHOLDS;
}
void classifyPage; // referenced only via ingestPdfTiered's internals; kept imported here so tsc -p webview-src/tsconfig.json still catches signature drift.
void currentThresholdsSnapshot;

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
  if (isHostRunMessage(parsed)) void runSpike(parsed);
}

function isHostRunMessage(x: unknown): x is HostToWebMessage {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as { type?: unknown }).type === "run" &&
    typeof (x as { fileName?: unknown }).fileName === "string" &&
    typeof (x as { pdfBase64?: unknown }).pdfBase64 === "string"
  );
}

// Android WebView historically dispatches postMessage events on `document`;
// some engines/versions use `window` instead — listen on both (cheap,
// idempotent: only one will ever actually fire per platform).
document.addEventListener("message", (e: Event) => handleRawHostMessage((e as MessageEvent).data));
window.addEventListener("message", (e: Event) => handleRawHostMessage((e as MessageEvent).data));

logToHost("info", "SPIKE F0.5: WebView entry ready, waiting for a run message from the host.");
