import { describe, expect, it } from "vitest";
import { buildSubsetUploadPlan, classifyIngestError, exceedsMaxPagesPerRequest, clientUploadModeForPageCount, parseIngestQuotaReason, truncateFileName } from "../materialIngest";
import { ApiError } from "../api/errors";
import type { IngestResult } from "../materialIngestBridge";

function ingestResult(overrides: Partial<IngestResult> = {}): IngestResult {
  return {
    fileName: "guia1.pdf",
    totalPages: 3,
    manifest: [
      { pageNumber: 1, claimedTier: "local", localText: "Texto local página 1." },
      { pageNumber: 2, claimedTier: "cloud", localText: null },
      { pageNumber: 3, claimedTier: "local", localText: "Texto local página 3." },
    ],
    cloudPages: [{ pageNumber: 2, base64: "UERGQllURVM=" }],
    ...overrides,
  };
}

describe("buildSubsetUploadPlan", () => {
  it("maps cloud pages to cloudPage-<N> fields matching apps/server's CLOUD_PAGE_FIELD_RE", () => {
    const plan = buildSubsetUploadPlan("subject-1", ingestResult());
    expect(plan.subjectId).toBe("subject-1");
    expect(plan.totalPages).toBe(3);
    expect(plan.originalFilename).toBe("guia1.pdf");
    expect(plan.files).toEqual([{ fieldName: "cloudPage-2", fileName: "page-2.pdf", base64: "UERGQllURVM=" }]);
  });

  it("serializes the manifest exactly as the server's SubsetPageManifestSchema expects", () => {
    const plan = buildSubsetUploadPlan("subject-1", ingestResult());
    const parsed = JSON.parse(plan.manifestJson);
    expect(parsed).toEqual([
      { pageNumber: 1, claimedTier: "local", localText: "Texto local página 1." },
      { pageNumber: 2, claimedTier: "cloud", localText: null },
      { pageNumber: 3, claimedTier: "local", localText: "Texto local página 3." },
    ]);
  });

  it("handles an all-local document (zero cloud pages, zero files)", () => {
    const result = ingestResult({
      manifest: [{ pageNumber: 1, claimedTier: "local", localText: "x" }],
      cloudPages: [],
      totalPages: 1,
    });
    const plan = buildSubsetUploadPlan("subject-1", result);
    expect(plan.files).toEqual([]);
  });

  it("handles multiple cloud pages, one file per page", () => {
    const result = ingestResult({
      manifest: [
        { pageNumber: 1, claimedTier: "cloud", localText: null },
        { pageNumber: 2, claimedTier: "cloud", localText: null },
      ],
      cloudPages: [
        { pageNumber: 1, base64: "AAA" },
        { pageNumber: 2, base64: "BBB" },
      ],
      totalPages: 2,
    });
    const plan = buildSubsetUploadPlan("subject-1", result);
    expect(plan.files.map((f) => f.fieldName)).toEqual(["cloudPage-1", "cloudPage-2"]);
  });
});

describe("classifyIngestError", () => {
  it("maps quota_exceeded to kind=quota", () => {
    const err = new ApiError("quota_exceeded", "Ingest quota exceeded (daily_ingest_pages)", 429);
    expect(classifyIngestError(err)).toEqual({
      kind: "quota",
      message: "Ingest quota exceeded (daily_ingest_pages)",
    });
  });

  it("maps raster_page_too_large to kind=raster_too_large", () => {
    const err = new ApiError("raster_page_too_large", "Page 3 is too large", 400);
    expect(classifyIngestError(err).kind).toBe("raster_too_large");
  });

  it("maps page-limit invalid_request to kind=too_many_pages", () => {
    const err = new ApiError("invalid_request", "25 pages exceeds the 20-page limit per upload", 400);
    expect(classifyIngestError(err).kind).toBe("too_many_pages");
  });

  it("maps safety_blocked to kind=safety", () => {
    const err = new ApiError("safety_blocked", "Material transcription blocked", 200);
    expect(classifyIngestError(err)).toEqual({ kind: "safety", message: "Material transcription blocked" });
  });

  it("maps invalid_request to kind=invalid_pdf", () => {
    const err = new ApiError("invalid_request", "Uploaded file is not a valid PDF", 400);
    expect(classifyIngestError(err)).toEqual({ kind: "invalid_pdf", message: "Uploaded file is not a valid PDF" });
  });

  it("maps network_error to kind=network", () => {
    const err = new ApiError("network_error", "fetch failed", null);
    expect(classifyIngestError(err)).toEqual({ kind: "network", message: "fetch failed" });
  });

  it("maps an unrecognized ApiError code to kind=unknown", () => {
    const err = new ApiError("internal_error", "boom", 500);
    expect(classifyIngestError(err)).toEqual({ kind: "unknown", message: "boom" });
  });

  it("maps a plain Error (not an ApiError) to kind=unknown with its message", () => {
    expect(classifyIngestError(new Error("plain failure"))).toEqual({ kind: "unknown", message: "plain failure" });
  });

  it("maps a non-Error thrown value to kind=unknown, stringified", () => {
    expect(classifyIngestError("just a string")).toEqual({ kind: "unknown", message: "just a string" });
  });
});

describe("exceedsMaxPagesPerRequest + clientUploadModeForPageCount + parseIngestQuotaReason + truncateFileName", () => {
  it("flags totals over the per-request cap", () => {
    expect(exceedsMaxPagesPerRequest(20)).toBe(false);
    expect(exceedsMaxPagesPerRequest(21)).toBe(true);
  });

  it("routes over-cap page counts to full upload (not a client reject)", () => {
    // Borders: at the subset cap → subset; one over → full (server book-index).
    expect(clientUploadModeForPageCount(20)).toBe("subset");
    expect(clientUploadModeForPageCount(21)).toBe("full");
    expect(clientUploadModeForPageCount(429)).toBe("full");
  });

  it("parses ingest quota reasons from the server message", () => {
    expect(parseIngestQuotaReason("Ingest quota exceeded (daily_ingest_pages)")).toBe("daily_ingest_pages");
    expect(parseIngestQuotaReason("Ingest quota exceeded (monthly_ingest_pages)")).toBe("monthly_ingest_pages");
    expect(parseIngestQuotaReason("Ingest quota exceeded (cost_cap)")).toBe("cost_cap");
    expect(parseIngestQuotaReason("something else")).toBe("unknown");
  });

  it("truncates long file names while keeping the extension", () => {
    expect(truncateFileName("short.pdf")).toBe("short.pdf");
    expect(truncateFileName("The_Distributed_Node_very_long_name.pdf", 20)).toMatch(/…\.pdf$/);
  });
});
