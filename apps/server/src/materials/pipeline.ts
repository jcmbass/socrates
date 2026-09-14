/**
 * Materials digestion pipeline — F2 WQ1 Part 2 (`digestMaterialPdf`,
 * full-PDF mode) + F2 WQ2 Part 1 (`digestMaterialSubset`, page-subset
 * mode) of `docs/plan-app-multiplataforma/05-plan-f2.md`.
 *
 * FULL-PDF MODE CONTRACT (`digestMaterialPdf`, as built in WQ1 — see
 * `docs/plan-app-multiplataforma/reports/wq1-reporte.md` for the full
 * writeup):
 *
 *   - The client uploads the WHOLE PDF.
 *   - An OPTIONAL `pages` manifest (`{pageNumber, claimedTier}[]`) may
 *     accompany the upload. It is accepted and can be inspected for
 *     telemetry, but is **never used for routing** — every page is
 *     independently re-parsed and re-classified from the uploaded bytes
 *     (risk #2: "el server nunca confía en la clasificación del cliente").
 *     This is the STRONGEST reading of risk #2: not just "don't trust the
 *     client's tier label", but "don't trust ANY client-supplied text
 *     either" — since the uploaded PDF always contains every page's real
 *     bytes, there is no reason to trust a client claim over the server's
 *     own $0 re-derivation.
 *
 * SUBSET MODE CONTRACT (`digestMaterialSubset`, new in WQ2 Part 1 — the
 * mobile client this wave adds, `apps/mobile`, needs this to avoid
 * uploading full PDF bytes for pages it already classified as local-tier
 * on-device): the client sends ONLY the bytes of pages it believes are
 * cloud-tier (each as an independently valid single-page PDF, extracted
 * client-side — see `apps/mobile`'s bridge module for how), plus a full
 * per-page manifest covering EVERY page of the original document
 * (`SubsetPageManifestEntry[]`, one entry per page 1..totalPages) carrying
 * the client's Tier-0 extracted text for the pages it kept local. Trust
 * policy (WQ1 report §5, "Qué queda para WQ2", + confirmed unchanged by
 * the Part 0b font-signal investigation — see
 * `docs/plan-app-multiplataforma/reports/wq2-font-signal.md` §4, no
 * client/server asymmetry was found that would motivate a different
 * policy):
 *
 *   - A page whose BYTES ARRIVE (claimedTier "cloud" in the manifest, a
 *     corresponding single-page PDF uploaded) is ALWAYS re-classified
 *     server-side from those bytes, exactly like full-PDF mode — the
 *     client's claim is never trusted for routing. If the server's own
 *     classification disagrees (the page turns out to be local-tier after
 *     all — "client-lies-in-subset"), the server extracts text at $0 and
 *     never transcribes it, exactly mirroring full-PDF mode's risk #2
 *     handling.
 *   - A page whose bytes NEVER ARRIVE (claimedTier "local", no file
 *     uploaded for it) is QUALITY-TRUST: the client's `localText` is used
 *     verbatim, with no re-verification possible (the server never
 *     receives the real bytes). This is NOT a quota-abuse surface — no
 *     model call ever depends on this text, only the material's quality —
 *     so it is accepted as-is, same as the plan frames it.
 *
 * Both modes share: cloud-tier pages are rasterized (`../raster/
 * rasterizer.ts`) and transcribed via the C7 `ingest` chain (`../models/
 * ingest.ts`, mocked in every test per this wave's hard rule); a
 * transcribed page's text passes through the SAME blocking safety
 * classifier the chat route uses (`../safety/classifier.ts`) before the
 * material is persisted — a flagged page aborts the whole material (no
 * partial unsafe content ever gets persisted) and records a
 * `SafetyIncident`; ingest quota (§2.5) is checked ONCE, up front, against
 * the number of cloud-tier pages the upload needs (post server-side
 * reclassification, never the client's claim) — same "block before spend"
 * pattern `checkTutorQuota` already uses; a per-page transcription failure
 * degrades gracefully with an honest marker, material persists with
 * `status: "partial"`.
 */
import type { MaterialProcessingEntry } from "@buxo/domain/material-asset";
import { reclassifyUploadedPdf } from "./reclassify";
import { digestLargePdfAsBookIndex } from "./toc-digest";
import {
  cloudPageProcessingEntry,
  logCloudPageTiming,
  type CloudPageOutcome,
  type CloudPageTimings,
} from "./cloud-page-report";
import { parsePdfNode } from "../pdf/parse-node";
import { NapiCanvasRasterizerService, RasterPageTooLargeError, type RasterizerService } from "../raster/rasterizer";
import { MAX_PAGES_PER_REQUEST } from "../raster/limits";
import { transcribePage } from "../models/ingest";
import type { ModelDeps } from "../models/adapters";
import type { SafetyClassifier, SafetyCategory } from "../safety/classifier";

export type { CloudPageOutcome, CloudPageTimings } from "./cloud-page-report";
export { cloudPageProcessingEntry } from "./cloud-page-report";

export interface MaterialPageManifestEntry {
  pageNumber: number;
  claimedTier: "local" | "cloud";
}

export interface MaterialsPipelineResult {
  status: "ready" | "partial";
  assembledText: string;
  /** `@buxo/domain`'s `MaterialProcessingEntry[]` directly — `route` here is always "local" | "cloud-page" (this wave never produces "cloud-figure", see `../pdf/parse-node.ts`'s module doc). */
  processingReport: MaterialProcessingEntry[];
}

export class MaterialTooLargeError extends Error {
  constructor(reason: string) {
    super(`Material upload rejected: ${reason}`);
    this.name = "MaterialTooLargeError";
  }
}

export class MaterialIngestQuotaExceededError extends Error {
  constructor(public readonly reason: "daily_ingest_pages" | "monthly_ingest_pages" | "cost_cap") {
    super(`Material ingest quota exceeded (${reason})`);
    this.name = "MaterialIngestQuotaExceededError";
  }
}

export class MaterialSafetyBlockedError extends Error {
  constructor(
    public readonly category: Exclude<SafetyCategory, "none">,
    public readonly pageNumber: number,
    public readonly classifierProviderId: string,
    public readonly classifierModelId: string,
  ) {
    super(`Material transcription blocked by safety classifier (category=${category}, page=${pageNumber})`);
    this.name = "MaterialSafetyBlockedError";
  }
}

/** Subset-mode protocol violations (WQ2 Part 1) — malformed manifest/bytes correspondence, NOT a trust-policy question (those degrade quietly per the module doc; these are hard 400s). */
export class MaterialSubsetManifestError extends Error {
  constructor(reason: string) {
    super(`Material subset upload rejected: ${reason}`);
    this.name = "MaterialSubsetManifestError";
  }
}

const CLOUD_PAGE_FAILURE_MARKER = "[Página no transcrita: fallo al transcribir esta página]";

export interface DigestMaterialPdfInput {
  pdfBytes: Uint8Array;
  subject: string | undefined;
  /** Accepted, inspected only for telemetry — never trusted for routing (see module doc). */
  clientPageManifest?: MaterialPageManifestEntry[];
}

export interface DigestMaterialPdfDeps {
  rasterizer?: RasterizerService;
  models: Pick<ModelDeps, "createIngestAdapter">;
  safetyClassifier: SafetyClassifier;
  /** Ingest quota check — injected so pipeline.ts stays free of DB/Db-shaped imports; the caller (routes/materials.ts) wires the real `checkIngestQuota`. */
  checkIngestQuota: (cloudPageCount: number) => Promise<{ ok: true } | { ok: false; reason: "daily_ingest_pages" | "monthly_ingest_pages" | "cost_cap" }>;
  /** Called once per successfully transcribed cloud page, for §2.5 usage recording — the caller wires `recordQuotaUsage`. null = costo no medible. */
  recordIngestUsage: (costUsd: number | null) => Promise<void>;
}

/**
 * Rasterizes `pdfBytes` at `pageNumberInBytes` (1-based, relative to
 * WHATEVER pdf `pdfBytes` is — the whole upload in full-PDF mode, a
 * single-page extract in subset mode), transcribes it via the C7 `ingest`
 * chain, and blocking-safety-checks the result. `originalPageNumber` is
 * ONLY used for error/report labeling (the student's actual document page
 * number) — it can differ from `pageNumberInBytes` in subset mode, where
 * each cloud page arrives as its own single-page PDF (`pageNumberInBytes`
 * is always 1 there).
 *
 * Throws `MaterialSafetyBlockedError` (caller must abort the whole
 * material, per module doc). Any other failure (model chain exhausted)
 * degrades in-band: returns `{ failed: true }` with the honest marker text
 * instead of throwing — mirrors `apps/harness/lib/pdf/orchestrate.ts`'s
 * `processCloudPage` contract.
 *
 * PROVIDER-AGNOSTIC SEAM (P1): `transcribeCloudPage` does NOT hardcode a
 * vision provider. It delegates to `transcribePage`, which builds a fresh
 * `IngestAdapter` from `deps.models.createIngestAdapter`. That adapter resolves
 * the `ingest` chain from the registry and skips candidates without `vision`
 * support. To swap to a local vLLM/OCR provider, add a registry row with
 * `vision: true` and configure `BUXO_INGEST_CHAIN` — no change here.
 */
/**
 * Exported so the large-PDF book-index path (`toc-digest.ts`) reuses the
 * same vision seam — no second transcription path (plan-temario-indice).
 */
export async function transcribeCloudPage(
  pdfBytes: Uint8Array,
  pageNumberInBytes: number,
  originalPageNumber: number,
  subject: string | undefined,
  deps: DigestMaterialPdfDeps,
  rasterizer: RasterizerService,
): Promise<CloudPageOutcome> {
  const t0 = Date.now();
  let rasterMs = 0;
  let modelMs = 0;
  let safetyMs = 0;
  try {
    const tRaster0 = Date.now();
    const raster = await rasterizer.rasterizePage({ pdfBytes, pageNumber: pageNumberInBytes });
    rasterMs = Date.now() - tRaster0;

    const tModel0 = Date.now();
    const transcription = await transcribePage(deps.models, { pngBytes: raster.png, subject });
    modelMs = Date.now() - tModel0;

    // Blocking safety check over transcribed text (existing stub/classifier,
    // same as the chat route) BEFORE this page's text ever gets assembled
    // into the material or persisted.
    const tSafety0 = Date.now();
    const classification = await deps.safetyClassifier.classify(transcription.text);
    safetyMs = Date.now() - tSafety0;
    if (classification.category !== "none") {
      throw new MaterialSafetyBlockedError(
        classification.category,
        originalPageNumber,
        classification.providerId,
        classification.modelId,
      );
    }

    await deps.recordIngestUsage(transcription.costUsd);
    const timings: CloudPageTimings = { rasterMs, modelMs, safetyMs, totalMs: Date.now() - t0 };
    logCloudPageTiming(originalPageNumber, timings, false);
    return { text: transcription.text, costUsd: transcription.costUsd, failed: false, cached: false, timings };
  } catch (err) {
    if (err instanceof MaterialSafetyBlockedError) throw err;
    // Absurd page size (won't fit even at scale 1) is NOT a soft per-page
    // failure — the student needs a clear API error (beta-real 07 B.1).
    if (err instanceof RasterPageTooLargeError) throw err;
    // Model chain exhausted (or any other per-page failure) degrades
    // gracefully — honest marker, keep going.
    const timings: CloudPageTimings = { rasterMs, modelMs, safetyMs, totalMs: Date.now() - t0 };
    logCloudPageTiming(originalPageNumber, timings, false);
    return { text: CLOUD_PAGE_FAILURE_MARKER, costUsd: 0, failed: true, cached: false, timings };
  }
}

/**
 * Runs the full server-side digestion of an uploaded PDF. Throws one of the
 * error classes above for conditions the caller must turn into a specific
 * HTTP error code + (for safety) a persisted `SafetyIncident` — everything
 * else (a single page's transcription failing) degrades in-band into the
 * returned `status: "partial"` + a failure marker.
 *
 * Large PDFs (`numPages > MAX_PAGES_PER_REQUEST`): instead of rejecting
 * immediately, attempt the book-index path (`toc-digest.ts`) — extract the
 * table of contents (1–3 pages) so a textbook upload can still feed a
 * temario. If no index is found, throw `MaterialTooLargeError` as before.
 * The 20-page cap for FULL-document digestion is unchanged.
 */
export async function digestMaterialPdf(input: DigestMaterialPdfInput, deps: DigestMaterialPdfDeps): Promise<MaterialsPipelineResult> {
  // Peek numPages + outline without normalizing every page — a 429-page
  // textbook must not pay a full parse before we decide on the index path.
  const peek = await parsePdfNode(input.pdfBytes, { pageNumbers: [] });

  if (peek.numPages > MAX_PAGES_PER_REQUEST) {
    const bookIndex = await digestLargePdfAsBookIndex(
      {
        pdfBytes: input.pdfBytes,
        numPages: peek.numPages,
        outline: peek.outline,
        subject: input.subject,
      },
      { ...deps, transcribeCloudPage },
    );
    if (bookIndex.kind === "quota_exceeded") {
      throw new MaterialIngestQuotaExceededError(bookIndex.reason);
    }
    if (bookIndex.kind === "ok") {
      return {
        status: bookIndex.status,
        assembledText: bookIndex.assembledText,
        processingReport: bookIndex.processingReport,
      };
    }
    throw new MaterialTooLargeError(
      `${peek.numPages} pages exceeds the ${MAX_PAGES_PER_REQUEST}-page limit per upload (no book index found)`,
    );
  }

  const reclassified = await reclassifyUploadedPdf(input.pdfBytes);

  const cloudPages = reclassified.pages.filter((p) => p.route.kind === "cloud-page");

  if (cloudPages.length > 0) {
    const quotaResult = await deps.checkIngestQuota(cloudPages.length);
    if (!quotaResult.ok) {
      throw new MaterialIngestQuotaExceededError(quotaResult.reason);
    }
  }

  const rasterizer = deps.rasterizer ?? new NapiCanvasRasterizerService();
  const report: MaterialProcessingEntry[] = [];
  const pageTexts = new Map<number, string>();
  let anyPageFailed = false;

  // Sequential, not parallel — same invariant `orchestrate.ts` documents
  // (§3.4 of C-cliente-e-ingesta.md): rasterizing a page is the heaviest
  // memory step, and this endpoint has its own hard page-count/timeout caps
  // rather than relying on client-side restraint.
  for (const page of reclassified.pages) {
    if (page.route.kind !== "cloud-page") {
      pageTexts.set(page.uploadedPageNumber, page.localText ?? "");
      report.push({ page: page.uploadedPageNumber, route: "local", costUsd: 0, cached: false });
      continue;
    }

    const outcome = await transcribeCloudPage(input.pdfBytes, page.uploadedPageNumber, page.uploadedPageNumber, input.subject, deps, rasterizer);
    pageTexts.set(page.uploadedPageNumber, outcome.text);
    report.push(cloudPageProcessingEntry(page.uploadedPageNumber, outcome));
    if (outcome.failed) anyPageFailed = true;
  }

  const assembledText = reclassified.pages
    .map((page) => pageTexts.get(page.uploadedPageNumber) ?? "")
    .filter((text) => text.length > 0)
    .join("\n\n---\n\n");

  return { status: anyPageFailed ? "partial" : "ready", assembledText, processingReport: report };
}

// ---------------------------------------------------------------------------
// Subset mode (F2 WQ2 Part 1) — see module doc's "SUBSET MODE CONTRACT".
// ---------------------------------------------------------------------------

export interface SubsetPageManifestEntry {
  pageNumber: number;
  claimedTier: "local" | "cloud";
  /**
   * Required (must be a non-null string) when `claimedTier` is "local" —
   * the client's Tier-0 extracted text for a page whose bytes the server
   * never receives. Ignored (may be null) when `claimedTier` is "cloud":
   * the server always re-derives text for those pages itself, from the
   * bytes it actually received (never from a client claim — see module
   * doc's risk #2 framing, ported unchanged from full-PDF mode).
   */
  localText: string | null;
}

export interface DigestMaterialSubsetInput {
  subject: string | undefined;
  totalPages: number;
  /** One entry per page 1..totalPages — see `SubsetPageManifestEntry`. */
  manifest: SubsetPageManifestEntry[];
  /** Single-page PDF bytes, keyed by ORIGINAL document page number — one entry per manifest row with `claimedTier: "cloud"`, no more, no less (enforced below). */
  cloudPageBytes: Map<number, Uint8Array>;
}

/** Same shape as `DigestMaterialPdfDeps` — kept as a separate alias so subset-mode callers don't have to import a name that says "Pdf" for a mode that (mostly) doesn't receive one. */
export type DigestMaterialSubsetDeps = DigestMaterialPdfDeps;

function validateSubsetInput(input: DigestMaterialSubsetInput): void {
  if (input.totalPages < 1 || !Number.isInteger(input.totalPages)) {
    throw new MaterialSubsetManifestError(`totalPages must be a positive integer, got ${input.totalPages}`);
  }
  if (input.totalPages > MAX_PAGES_PER_REQUEST) {
    throw new MaterialTooLargeError(`${input.totalPages} pages exceeds the ${MAX_PAGES_PER_REQUEST}-page limit per upload`);
  }

  const seen = new Set<number>();
  for (const entry of input.manifest) {
    if (entry.pageNumber < 1 || entry.pageNumber > input.totalPages) {
      throw new MaterialSubsetManifestError(`manifest page ${entry.pageNumber} is out of range 1..${input.totalPages}`);
    }
    if (seen.has(entry.pageNumber)) {
      throw new MaterialSubsetManifestError(`manifest has a duplicate entry for page ${entry.pageNumber}`);
    }
    seen.add(entry.pageNumber);
    if (entry.claimedTier === "local" && (entry.localText === null || entry.localText === undefined)) {
      throw new MaterialSubsetManifestError(`page ${entry.pageNumber} claims tier "local" but has no localText`);
    }
  }
  for (let p = 1; p <= input.totalPages; p++) {
    if (!seen.has(p)) throw new MaterialSubsetManifestError(`manifest is missing an entry for page ${p} (must cover every page 1..totalPages)`);
  }

  const claimedCloudPages = new Set(input.manifest.filter((e) => e.claimedTier === "cloud").map((e) => e.pageNumber));
  for (const pageNumber of input.cloudPageBytes.keys()) {
    if (!claimedCloudPages.has(pageNumber)) {
      throw new MaterialSubsetManifestError(`bytes were uploaded for page ${pageNumber}, but the manifest doesn't claim it as "cloud"`);
    }
  }
  for (const pageNumber of claimedCloudPages) {
    if (!input.cloudPageBytes.has(pageNumber)) {
      throw new MaterialSubsetManifestError(`manifest claims page ${pageNumber} as "cloud" but no bytes were uploaded for it`);
    }
  }
}

/**
 * Runs server-side digestion of a page-SUBSET upload (F2 WQ2 Part 1): only
 * cloud-tier page bytes arrive; local-tier pages are trusted quality-wise
 * (their text is the client's `manifest[].localText`, never re-verified —
 * see module doc's "SUBSET MODE CONTRACT"). Same error classes/degrade
 * contract as `digestMaterialPdf`, plus `MaterialSubsetManifestError` for
 * malformed manifest/bytes correspondence (protocol violation, not a trust
 * question — always a hard 400, per the route).
 */
export async function digestMaterialSubset(input: DigestMaterialSubsetInput, deps: DigestMaterialSubsetDeps): Promise<MaterialsPipelineResult> {
  validateSubsetInput(input);

  const manifestByPage = new Map(input.manifest.map((e) => [e.pageNumber, e]));

  // Re-classify every uploaded cloud-page-bytes file from its OWN bytes
  // (never the client's claim) BEFORE checking quota — same "server always
  // re-derives" invariant as full-PDF mode's risk #2 handling, just applied
  // per single-page-PDF file instead of once against the whole document.
  interface ReclassifiedCloudPage {
    originalPageNumber: number;
    pdfBytes: Uint8Array;
    isServerCloud: boolean;
    /** Non-null only when the server's OWN reclassification says this page is local-tier after all ("client-lies-in-subset") — extracted at $0 from the real bytes received. */
    serverLocalText: string | null;
  }
  const reclassifiedCloudPages: ReclassifiedCloudPage[] = [];
  for (const [pageNumber, pdfBytes] of input.cloudPageBytes) {
    const reclassified = await reclassifyUploadedPdf(pdfBytes);
    if (reclassified.numPages !== 1) {
      throw new MaterialSubsetManifestError(
        `page ${pageNumber}'s uploaded bytes contain ${reclassified.numPages} pages — subset mode requires one independently valid single-page PDF per cloud page`,
      );
    }
    const [page] = reclassified.pages;
    reclassifiedCloudPages.push({
      originalPageNumber: pageNumber,
      pdfBytes,
      isServerCloud: page.route.kind === "cloud-page",
      serverLocalText: page.route.kind === "cloud-page" ? null : (page.localText ?? ""),
    });
  }

  const serverCloudPages = reclassifiedCloudPages.filter((p) => p.isServerCloud);
  if (serverCloudPages.length > 0) {
    const quotaResult = await deps.checkIngestQuota(serverCloudPages.length);
    if (!quotaResult.ok) {
      throw new MaterialIngestQuotaExceededError(quotaResult.reason);
    }
  }

  const rasterizer = deps.rasterizer ?? new NapiCanvasRasterizerService();
  const report: MaterialProcessingEntry[] = [];
  const pageTexts = new Map<number, string>();
  let anyPageFailed = false;

  const reclassifiedByPage = new Map(reclassifiedCloudPages.map((p) => [p.originalPageNumber, p]));

  // Sequential, not parallel — same invariant as digestMaterialPdf.
  for (let pageNumber = 1; pageNumber <= input.totalPages; pageNumber++) {
    const manifestEntry = manifestByPage.get(pageNumber)!; // validateSubsetInput guarantees full coverage
    const uploaded = reclassifiedByPage.get(pageNumber);

    if (!uploaded) {
      // claimedTier "local", no bytes ever arrived — quality-trust the
      // client's Tier-0 text verbatim (module doc's "SUBSET MODE CONTRACT").
      pageTexts.set(pageNumber, manifestEntry.localText ?? "");
      report.push({ page: pageNumber, route: "local", costUsd: 0, cached: false });
      continue;
    }

    if (!uploaded.isServerCloud) {
      // "client-lies-in-subset": bytes arrived, claimed "cloud", but the
      // server's OWN reclassification says local-tier — extract at $0,
      // never transcribe (identical spirit to full-PDF mode's risk #2).
      pageTexts.set(pageNumber, uploaded.serverLocalText ?? "");
      report.push({ page: pageNumber, route: "local", costUsd: 0, cached: false });
      continue;
    }

    const outcome = await transcribeCloudPage(uploaded.pdfBytes, 1, pageNumber, input.subject, deps, rasterizer);
    pageTexts.set(pageNumber, outcome.text);
    report.push(cloudPageProcessingEntry(pageNumber, outcome));
    if (outcome.failed) anyPageFailed = true;
  }

  const assembledText = Array.from(pageTexts.entries())
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text)
    .filter((text) => text.length > 0)
    .join("\n\n---\n\n");

  return { status: anyPageFailed ? "partial" : "ready", assembledText, processingReport: report };
}
