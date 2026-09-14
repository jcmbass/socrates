/**
 * Student-facing copy for ingest errors (beta-real 07 B.2/B.3).
 * Pure + i18n — keeps MaterialIngestBar / SourcesModal / pdfErrorCopy aligned.
 */
import { getStrings } from "../i18n";
import { parseIngestQuotaReason } from "./materialIngest";
import { MAX_PAGES_PER_REQUEST } from "./materialIngestLimits";
import type { IngestErrorKind } from "./materialIngestState";

type QuotaCopy = {
  quota: string;
  quotaDaily: string;
  quotaMonthly: string;
  quotaCost: string;
};

type IngestErrorCopy = QuotaCopy & {
  network: string;
  safety: string;
  invalid_pdf: string;
  too_many_pages: (max: number) => string;
  raster_too_large: string;
  timeout: string;
  unknown: string;
  /** Only fuentes reconcile of a server `failed` row; other copy objects omit it. */
  digestFailed?: string;
};

function quotaMessage(copy: QuotaCopy, serverMessage: string): string {
  switch (parseIngestQuotaReason(serverMessage)) {
    case "daily_ingest_pages":
      return copy.quotaDaily;
    case "monthly_ingest_pages":
      return copy.quotaMonthly;
    case "cost_cap":
      return copy.quotaCost;
    default:
      return copy.quota;
  }
}

export function materialIngestErrorCopy(
  kind: Exclude<IngestErrorKind, "cancelled">,
  serverMessage = "",
  copy: IngestErrorCopy = getStrings().materialIngest.errors,
): string {
  switch (kind) {
    case "quota":
      return quotaMessage(copy, serverMessage);
    case "too_many_pages":
      return copy.too_many_pages(MAX_PAGES_PER_REQUEST);
    case "raster_too_large":
      return copy.raster_too_large;
    case "timeout":
      return copy.timeout;
    case "network":
      return copy.network;
    case "safety":
      return copy.safety;
    case "invalid_pdf":
      return copy.invalid_pdf;
    case "digest_failed":
      return copy.digestFailed ?? copy.unknown;
    default:
      return copy.unknown;
  }
}

/**
 * GET /v1/materials exposes `status: "failed"` and nothing else — no error
 * code, no reason field on `material_assets`. Do not invent a more specific
 * cause (quota vs safety vs zombie) from an empty processingReport.
 */
export function reconcileDigestFailedError(): { kind: "digest_failed"; message: string } {
  // Active catalog at CALL time — the LocaleProvider keeps it in lock-step
  // with React state, so copy follows a locale switch without a subscription.
  const t = getStrings();
  return { kind: "digest_failed", message: t.fuentes.errors.digestFailed };
}

export function fuentesIngestErrorCopy(
  kind: Exclude<IngestErrorKind, "cancelled">,
  serverMessage = "",
): string {
  return materialIngestErrorCopy(kind, serverMessage, getStrings().fuentes.errors);
}

export function skillTreeIngestErrorCopy(
  kind: Exclude<IngestErrorKind, "cancelled"> | "generate_failed",
  serverMessage = "",
): string {
  const copy = getStrings().skillTree.emptyState.errors;
  if (kind === "generate_failed") return copy.generate_failed;
  return materialIngestErrorCopy(kind, serverMessage, copy);
}
