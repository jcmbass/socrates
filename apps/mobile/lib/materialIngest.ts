/**
 * Material ingest orchestration — F2 WQ2 Part 2. PURE data transforms
 * (no fetch, no FormData, no RN) so the "subset assembly" contract (the
 * plan's own phrase) is offline-testable; the actual network call lives in
 * `lib/api/client.ts`'s `uploadMaterialSubset`/`attachMaterialToSession`
 * (thin, DI'd fetch, same pattern as every other client method).
 */
import type { IngestResult } from "./materialIngestBridge";
import { ApiError, isNetworkError, isQuotaExceeded } from "./api/errors";
import type { IngestErrorKind } from "./materialIngestState";
import { MAX_PAGES_PER_REQUEST } from "./materialIngestLimits";

/** One cloud-tier page's upload field — `fieldName` matches apps/server/src/routes/materials.ts's CLOUD_PAGE_FIELD_RE (`cloudPage-<pageNumber>`). */
export interface SubsetUploadFile {
  fieldName: string;
  fileName: string;
  base64: string;
}

/** Everything `uploadMaterialSubset` needs to build the multipart request — a plain data object, easy to assert against without touching FormData/Blob. */
export interface SubsetUploadPlan {
  subjectId: string;
  totalPages: number;
  /** JSON-encoded, matches the server's `pages` form field contract exactly (apps/server/src/routes/materials.ts's SubsetPageManifestSchema). */
  manifestJson: string;
  originalFilename: string;
  files: SubsetUploadFile[];
  /** Idempotency key — same spirit as turn clientMessageId. */
  clientUploadId?: string;
}

export type IngestQuotaReason = "daily_ingest_pages" | "monthly_ingest_pages" | "cost_cap" | "unknown";

/**
 * Turns the WebView bridge's `IngestResult` (parse+classify+split, done
 * on-device) into the exact shape the server's subset endpoint expects
 * (F2 WQ2 Part 1, `POST /v1/materials` with `mode=subset`) — one file
 * field per cloud-tier page, a manifest covering every page.
 */
export function buildSubsetUploadPlan(subjectId: string, result: IngestResult): SubsetUploadPlan {
  const files: SubsetUploadFile[] = result.cloudPages.map((cp) => ({
    fieldName: `cloudPage-${cp.pageNumber}`,
    fileName: `page-${cp.pageNumber}.pdf`,
    base64: cp.base64,
  }));

  return {
    subjectId,
    totalPages: result.totalPages,
    manifestJson: JSON.stringify(result.manifest),
    originalFilename: result.fileName,
    files,
  };
}

/** True when the PDF exceeds the per-request page cap used by the subset path. */
export function exceedsMaxPagesPerRequest(totalPages: number, max: number = MAX_PAGES_PER_REQUEST): boolean {
  return totalPages > max;
}

/**
 * What the client should do once it knows `totalPages`.
 *
 * Historically `> MAX_PAGES_PER_REQUEST` was a hard client reject (beta-real
 * 07 B.2). The server now digests large PDFs via the book-index path
 * (`digestLargePdfAsBookIndex`) when it finds a TOC, so the client must
 * upload the whole file (`uploadMaterialFull`) instead of failing — same
 * Option B path already used for binaries over `CLIENT_WEBVIEW_MAX_BYTES`.
 *
 * Subset mode still cannot carry >20 pages (server rejects the manifest).
 */
export type ClientUploadMode = "subset" | "full";

export function clientUploadModeForPageCount(
  totalPages: number,
  max: number = MAX_PAGES_PER_REQUEST,
): ClientUploadMode {
  return exceedsMaxPagesPerRequest(totalPages, max) ? "full" : "subset";
}

/** Pull the quota reason out of the server's `Ingest quota exceeded (reason)` message. */
export function parseIngestQuotaReason(message: string): IngestQuotaReason {
  if (message.includes("daily_ingest_pages")) return "daily_ingest_pages";
  if (message.includes("monthly_ingest_pages")) return "monthly_ingest_pages";
  if (message.includes("cost_cap")) return "cost_cap";
  return "unknown";
}

/**
 * Classifies an upload/attach failure into the ingestion state machine's
 * error vocabulary (`materialIngestState.ts`'s `IngestErrorKind`) — the UI
 * layer never inspects `ApiError` directly, it dispatches
 * `{kind, message}` from here, keeping the error taxonomy in ONE place.
 *
 * For quota, `message` keeps the server reason so the UI can name which
 * quota and when it renews (beta-real 07 B.3) via `parseIngestQuotaReason`.
 */
export function classifyIngestError(err: unknown): { kind: Exclude<IngestErrorKind, "cancelled">; message: string } {
  if (isQuotaExceeded(err)) return { kind: "quota", message: err.message };
  if (err instanceof ApiError && err.code === "safety_blocked") return { kind: "safety", message: err.message };
  if (err instanceof ApiError && err.code === "raster_page_too_large") {
    return { kind: "raster_too_large", message: err.message };
  }
  if (err instanceof ApiError && err.code === "invalid_request") {
    if (/pages exceeds the \d+-page limit/i.test(err.message)) {
      return { kind: "too_many_pages", message: err.message };
    }
    return { kind: "invalid_pdf", message: err.message };
  }
  if (isNetworkError(err)) return { kind: "network", message: err.message };
  if (err instanceof ApiError) return { kind: "unknown", message: err.message };
  return { kind: "unknown", message: err instanceof Error ? err.message : String(err) };
}

/** Truncate a display name for progress copy — keep extension visible. */
export function truncateFileName(fileName: string, maxLen = 28): string {
  if (fileName.length <= maxLen) return fileName;
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot) : "";
  const keep = Math.max(4, maxLen - ext.length - 1);
  return `${fileName.slice(0, keep)}…${ext}`;
}
