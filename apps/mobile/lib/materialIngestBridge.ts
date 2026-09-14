/**
 * Material ingest bridge — PRODUCTION module (F2 WQ2 Part 2), promoted
 * from the SPIKE F0.5 pattern (`lib/spikeF05Bridge.ts`, kept intact and
 * still working per that file's own docblock). Same discipline as the
 * spike: the message SHAPES crossing a `postMessage` boundary are exactly
 * the kind of thing that gets silently wrong (per
 * `docs/LECCIONES-Y-BUGS.md`'s `Math.sumPrecise` worker lesson,
 * 2026-07-11) — this file is PURE (no RN, no DOM) so it gets an offline
 * vitest contract test instead of only being hand-verified on-device, and
 * both sides of the bridge (the RN host + the WebView bundle, via
 * `materials/build.mjs`) import this SAME file, one source of truth for
 * the wire shape.
 *
 * Differs from the spike in what actually crosses the wire: the spike
 * called a MOCKED `transcribe` locally inside the WebView (§0 point 4 of
 * the spike spec — no real API calls allowed there). Production never
 * transcribes client-side at all — the WebView's only job is parse +
 * classify + (for cloud-tier pages) extract a single-page PDF via
 * `pdf-lib`, matching the server contract F2 WQ2 Part 1 built
 * (`apps/server/src/materials/pipeline.ts`'s "SUBSET MODE CONTRACT" —
 * bytes for cloud pages, `localText` for pages kept local). Real
 * transcription happens server-side, in the SAME request that uploads the
 * subset (`POST /v1/materials` with `mode=subset`).
 */

/** Host (RN) -> WebView: parse+classify+split ONE PDF, arbitrary bytes chosen by the student at runtime (document picker), not a build-time-embedded fixture. */
export interface HostIngestMessage {
  type: "ingest";
  requestId: string;
  fileName: string;
  /** Raw PDF bytes, base64-encoded (postMessage only carries strings). */
  pdfBase64: string;
}

export type HostToWebMessage = HostIngestMessage;

export interface WebProgressMessage {
  type: "progress";
  requestId: string;
  page: number;
  total: number;
  /** classify.ts's PageRoute["kind"], mirrored as a string across the bridge. */
  routeKind: string;
}

/** One page of the manifest the server's subset endpoint expects (mirrors apps/server/src/materials/pipeline.ts's SubsetPageManifestEntry — this is the WIRE copy, not an import, per the package-boundary reasoning packages/pdf's docblocks already establish for apps/harness vs apps/server). */
export interface IngestManifestEntry {
  pageNumber: number;
  claimedTier: "local" | "cloud";
  /** Non-null only when claimedTier is "local" — the Tier-0 text extracted ON-DEVICE, never uploaded as page bytes (privacy note: this text leaves the device only as part of the material the student explicitly submits, per the plan's Part 2 instruction). */
  localText: string | null;
}

/** One cloud-tier page's single-page PDF extract, ready to upload as `cloudPage-<pageNumber>` (apps/server/src/routes/materials.ts's CLOUD_PAGE_FIELD_RE). */
export interface IngestCloudPage {
  pageNumber: number;
  /** Single-page PDF bytes, base64-encoded. */
  base64: string;
}

export interface IngestResult {
  fileName: string;
  totalPages: number;
  /** One entry per page 1..totalPages — see IngestManifestEntry. */
  manifest: IngestManifestEntry[];
  cloudPages: IngestCloudPage[];
}

export interface WebResultMessage {
  type: "result";
  requestId: string;
  result: IngestResult;
}

export interface WebFatalMessage {
  type: "fatal";
  requestId: string;
  message: string;
}

export type WebToHostMessage = WebProgressMessage | WebResultMessage | WebFatalMessage;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

export function isHostToWebMessage(x: unknown): x is HostToWebMessage {
  if (!isRecord(x)) return false;
  return (
    x.type === "ingest" &&
    typeof x.requestId === "string" &&
    typeof x.fileName === "string" &&
    typeof x.pdfBase64 === "string" &&
    x.pdfBase64.length > 0
  );
}

function isIngestManifestEntry(x: unknown): x is IngestManifestEntry {
  if (!isRecord(x)) return false;
  return (
    typeof x.pageNumber === "number" &&
    (x.claimedTier === "local" || x.claimedTier === "cloud") &&
    (x.localText === null || typeof x.localText === "string")
  );
}

function isIngestCloudPage(x: unknown): x is IngestCloudPage {
  if (!isRecord(x)) return false;
  return typeof x.pageNumber === "number" && typeof x.base64 === "string" && x.base64.length > 0;
}

function isIngestResult(x: unknown): x is IngestResult {
  if (!isRecord(x)) return false;
  return (
    typeof x.fileName === "string" &&
    typeof x.totalPages === "number" &&
    Array.isArray(x.manifest) &&
    x.manifest.every(isIngestManifestEntry) &&
    Array.isArray(x.cloudPages) &&
    x.cloudPages.every(isIngestCloudPage)
  );
}

export function isWebToHostMessage(x: unknown): x is WebToHostMessage {
  if (!isRecord(x)) return false;
  if (typeof x.requestId !== "string") return false;
  switch (x.type) {
    case "progress":
      return typeof x.page === "number" && typeof x.total === "number" && typeof x.routeKind === "string";
    case "result":
      return isIngestResult(x.result);
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
