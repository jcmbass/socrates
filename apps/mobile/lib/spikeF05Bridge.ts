/**
 * SPIKE F0.5 (ingestion memory gate, __DEV__-only, THROWAWAY) — bridge
 * contract between the RN dev screen (`app/dev/spike-f05.tsx`) and the
 * hidden WebView that runs the real `lib/pdf/` pipeline
 * (`spike-f05/webview-src/entry.ts`, bundled by `spike-f05/build.mjs`).
 *
 * Kept as a PURE module (no RN, no DOM) deliberately — per
 * `docs/LECCIONES-Y-BUGS.md` pattern 4/7, the message SHAPES are exactly
 * the kind of thing a `postMessage` bridge gets wrong silently (see the
 * `Math.sumPrecise` worker lesson, 2026-07-11), so they get an offline
 * vitest contract test (`__tests__/spikeF05Bridge.test.ts`) instead of only
 * being hand-verified on-device. Both sides of the bridge import this same
 * file: the browser bundle (via esbuild, see build.mjs) AND the RN screen
 * (via Metro) — one source of truth for the wire shape, per
 * LECCIONES-Y-BUGS pattern 5 ("reusa primitivas, no dupliques").
 *
 * SPIKE, not product code: this whole module is deleted along with
 * `spike-f05/` and `app/dev/spike-f05.tsx` once F0.5's verdict lands
 * (docs/plan-app-multiplataforma/especificaciones/C-cliente-e-ingesta.md
 * §2.6 step 7 — "el código throwaway se descarta").
 */

/** Host (RN) -> WebView. Only one message type today: "go fetch/parse/classify this PDF". */
export interface HostRunMessage {
  type: "run";
  fileName: string;
  /** Raw PDF bytes, base64-encoded (postMessage only carries strings). */
  pdfBase64: string;
}

export type HostToWebMessage = HostRunMessage;

export interface WebLogMessage {
  type: "log";
  level: "log" | "info" | "warn" | "error";
  message: string;
  ts: number;
}

export interface WebProgressMessage {
  type: "progress";
  page: number;
  total: number;
  /** classify.ts's PageRoute["kind"], mirrored as a string across the bridge. */
  routeKind: string;
}

export interface BlobDiagnostic {
  mode: "figure" | "page";
  sizeBytes: number;
  /** First 8 bytes matched the PNG signature (89 50 4E 47 0D 0A 1A 0A). */
  pngMagicValid: boolean;
}

export interface WorkerDiagnostics {
  /** `typeof Worker !== "undefined"` in the WebView's global scope. */
  workerGlobalAvailable: boolean;
  /** Our `new Worker(...)` -> blob-URL substitution (see entry.ts) installed without throwing. */
  workerPatchInstalled: boolean;
  /** Any construction/spawn errors caught around the patched Worker. */
  workerConstructionErrors: string[];
}

export interface ConsoleEvent {
  level: string;
  message: string;
  ts: number;
}

export interface UnhandledErrorEvent {
  message: string;
  stack?: string;
}

/** One `ProcessingReport` row, mirrored (not imported — the WebView bundle owns the real type from orchestrate.ts; this is the wire copy). */
export interface ReportRow {
  page: number;
  route: "local" | "cloud-figure" | "cloud-page";
  costUsd: number;
  cached: boolean;
}

export interface SpikeResult {
  fileName: string;
  totalElapsedMs: number;
  routes: Array<{ page: number; total: number; routeKind: string }>;
  /**
   * Full assembled markdown (lib/pdf/assemble.ts output). Tier-0 (local)
   * text appears verbatim; mocked cloud output is prefixed with
   * MOCK_CLOUD_MARKER so an offline script can strip it before computing
   * fidelity against docs/guia1.txt (see spike-f05/fidelity.mjs).
   */
  materialText: string;
  report: ReportRow[];
  blobDiagnostics: BlobDiagnostic[];
  consoleEvents: ConsoleEvent[];
  unhandledErrors: UnhandledErrorEvent[];
  workerDiagnostics: WorkerDiagnostics;
}

export interface WebResultMessage {
  type: "result";
  result: SpikeResult;
}

export interface WebFatalMessage {
  type: "fatal";
  message: string;
}

export type WebToHostMessage =
  | WebLogMessage
  | WebProgressMessage
  | WebResultMessage
  | WebFatalMessage;

/** Distinctive marker prefixing every mocked-transcribe string (§0 point 4 of the spec: no real API call — this marker makes that visually/programmatically obvious in every dump). */
export const MOCK_CLOUD_MARKER = "⟦F05-MOCK-CLOUD⟧";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

export function isHostToWebMessage(x: unknown): x is HostToWebMessage {
  if (!isRecord(x)) return false;
  return (
    x.type === "run" &&
    typeof x.fileName === "string" &&
    typeof x.pdfBase64 === "string" &&
    x.pdfBase64.length > 0
  );
}

export function isWebToHostMessage(x: unknown): x is WebToHostMessage {
  if (!isRecord(x)) return false;
  switch (x.type) {
    case "log":
      return (
        typeof x.message === "string" &&
        typeof x.ts === "number" &&
        (x.level === "log" || x.level === "info" || x.level === "warn" || x.level === "error")
      );
    case "progress":
      return (
        typeof x.page === "number" && typeof x.total === "number" && typeof x.routeKind === "string"
      );
    case "result":
      return isRecord(x.result) && typeof x.result.fileName === "string";
    case "fatal":
      return typeof x.message === "string";
    default:
      return false;
  }
}

/**
 * Best-effort JSON.parse + shape guard for whatever a WebView's
 * `onMessage`/`postMessage` handed us — those events are always raw
 * strings, and a malformed/partial payload should degrade to `null`
 * instead of throwing inside a React event handler.
 */
export function parseWebToHostMessage(raw: string): WebToHostMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isWebToHostMessage(parsed) ? parsed : null;
}

/**
 * Splits a large JSON payload into logcat-safe chunks: `adb logcat` lines
 * get truncated well before typical JSON-string lengths (SpikeResult with
 * `materialText` + console events can run tens of KB). Chunks are prefixed
 * so an offline script (`grep`+reassemble) can recover the original string
 * regardless of interleaving with other logcat lines.
 */
export const LOGCAT_CHUNK_SIZE = 3000;
export const LOGCAT_MARKER = "F05_SPIKE_RESULT";

export function chunkForLogcat(payload: string): string[] {
  const total = Math.max(1, Math.ceil(payload.length / LOGCAT_CHUNK_SIZE));
  const chunks: string[] = [];
  for (let i = 0; i < total; i++) {
    const part = payload.slice(i * LOGCAT_CHUNK_SIZE, (i + 1) * LOGCAT_CHUNK_SIZE);
    chunks.push(`${LOGCAT_MARKER} ${i + 1}/${total} ${part}`);
  }
  return chunks;
}
