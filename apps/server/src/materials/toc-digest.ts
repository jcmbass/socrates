/**
 * Large-PDF book-index path — docs/plan-temario-indice.
 *
 * When a student uploads a textbook (hundreds of pages) to build a temario,
 * reading the whole book is wrong twice: it blows `MAX_PAGES_PER_REQUEST`,
 * and the book's full text is a worse temario signal than its INDEX (the
 * book covers topics the course does not evaluate).
 *
 * This module runs ONLY when `numPages > MAX_PAGES_PER_REQUEST`. It does
 * NOT raise that cap for the full-document path. Steps:
 *
 *   1. `outlineToTocLocator(outline)` — outline is the LOCATOR (or, when
 *      rich, a temario candidate of its own).
 *   2. Else `findTocPages` on the first ~25 pages (the common path — most
 *      of the corpus has no outline).
 *   3. Extract 1–3 index pages at Tier-0 (`pageTextToMarkdown`) when the
 *      digital text is usable; otherwise rasterize+transcribe those few
 *      pages via the existing cloud-page seam injected by the caller.
 *   4. `parseTocText` + `buildTemarioDraft` — hierarchy, NO automatic
 *      recorte (a book index ≠ a course temario).
 *   5. If nothing locates an index → `{ kind: "not_found" }` so the caller
 *      preserves today's `MaterialTooLargeError`.
 */
import type { MaterialProcessingEntry } from "@buxo/domain/material-asset";
import { classifyPage, DEFAULT_THRESHOLDS } from "@buxo/pdf/classify";
import { pageTextToMarkdown } from "@buxo/pdf/pageText";
import { cloudPageProcessingEntry, type CloudPageOutcome } from "./cloud-page-report";
import {
  buildTemarioDraft,
  findTocPages,
  outlineToTocLocator,
  parseTocText,
  type OutlineEntry,
  type TemarioDraft,
  type TocEntry,
} from "@buxo/pdf/toc";
import type { NormalizedPage } from "@buxo/pdf/types";
import { parsePdfNode } from "../pdf/parse-node";
import type { RasterizerService } from "../raster/rasterizer";
import { NapiCanvasRasterizerService } from "../raster/rasterizer";
import type { ModelDeps } from "../models/adapters";
import type { SafetyClassifier } from "../safety/classifier";

/** How many leading pages to score with `findTocPages` when the outline offers nothing. */
export const TOC_PREFIX_SCAN_PAGES = 25;
/** Hard cap on index pages extracted (Tier-0 or vision) — never the whole book. */
export const TOC_MAX_EXTRACT_PAGES = 3;

/**
 * Honest header persisted into the Fuente text. Adult register (bachillerato/
 * universidad — docs/plan-producto-maqueta/00-vision-decisiones.md). Makes
 * unmistakable that the student received the book's INDEX, not the book and
 * not a course-scoped temario.
 */
export const BOOK_INDEX_FUENTE_HEADER = `# Índice del libro (no es el temario de tu curso)

Extraímos el índice de este PDF — no el libro completo. El índice lista todo lo que el material cubre; tu curso normalmente evalúa solo una parte. Usá esta jerarquía como base y recortá lo que no entre en tu programa.`;

export interface DigestLargePdfAsBookIndexInput {
  pdfBytes: Uint8Array;
  numPages: number;
  outline: OutlineEntry[];
  subject: string | undefined;
}

export type BookIndexLocateResult =
  | { found: false }
  | {
      found: true;
      /** How the index was located — reflected in the persisted text. */
      via: "outline-locator" | "outline-rich" | "heuristic";
      /** Pages to extract (empty when `via === "outline-rich"` — draft comes from bookmarks). */
      pageNumbers: number[];
      /** Pre-built when the outline itself is the temario candidate. */
      draftFromOutline?: TemarioDraft;
    };

export type BookIndexDigestOk = {
  kind: "ok";
  status: "ready" | "partial";
  assembledText: string;
  processingReport: MaterialProcessingEntry[];
};

export type BookIndexDigestOutcome =
  | { kind: "not_found" }
  | { kind: "quota_exceeded"; reason: "daily_ingest_pages" | "monthly_ingest_pages" | "cost_cap" }
  | BookIndexDigestOk;

/**
 * Pure decision: given outline + (optional) already-parsed candidate pages,
 * where is the index? Exported for mutation-tested unit coverage without
 * opening a PDF.
 */
export function locateBookIndex(input: {
  outline: OutlineEntry[];
  /** First ~25 pages (or a locator window); may be empty when only the outline is known so far. */
  candidatePages: NormalizedPage[];
  numPages: number;
}): BookIndexLocateResult {
  const locator = outlineToTocLocator(input.outline);

  if (locator.kind === "toc-page") {
    const start = locator.pageNumber;
    const windowPages = input.candidatePages.filter(
      (p) => p.pageNumber >= start && p.pageNumber < start + TOC_MAX_EXTRACT_PAGES,
    );
    const scored = findTocPages(windowPages);
    const pageNumbers =
      scored.length > 0
        ? scored.map((c) => c.pageNumber).slice(0, TOC_MAX_EXTRACT_PAGES)
        : [start].filter((p) => p >= 1 && p <= input.numPages);
    if (pageNumbers.length === 0) return { found: false };
    return { found: true, via: "outline-locator", pageNumbers };
  }

  if (locator.kind === "outline-rich") {
    const entries: TocEntry[] = input.outline.map((e) => ({
      title: e.title,
      pageNumber: String(e.pageNumber),
      level: e.level,
    }));
    return {
      found: true,
      via: "outline-rich",
      pageNumbers: [],
      draftFromOutline: buildTemarioDraft(entries),
    };
  }

  const scored = findTocPages(input.candidatePages);
  if (scored.length === 0) return { found: false };
  return {
    found: true,
    via: "heuristic",
    pageNumbers: scored.map((c) => c.pageNumber).slice(0, TOC_MAX_EXTRACT_PAGES),
  };
}

/**
 * Digital text is usable for an index when Tier-0 markdown is non-trivial
 * AND the page is not a full-page scan. Deliberately NOT "classify says
 * local-text": real TOC pages often score as `cloud-page`/`table` (two
 * columns of short lines — measured on introduction-to-algorithms pages
 * 3–4) while still having clean extractable text. Sending those to vision
 * would waste cents for no gain.
 */
export function pageHasUsableDigitalText(page: NormalizedPage): boolean {
  const md = pageTextToMarkdown(page).trim();
  if (md.length < 20) return false;
  const classification = classifyPage(page, DEFAULT_THRESHOLDS);
  if (classification.route.kind === "cloud-page" && classification.route.reason === "scanned") {
    return false;
  }
  return true;
}

export function formatTemarioDraftMarkdown(draft: TemarioDraft): string {
  const lines: string[] = [];
  for (const chapter of draft.chapters) {
    lines.push(`## ${chapter.title}`);
    for (const section of chapter.sections) {
      const page = section.pageNumber ? ` (p. ${section.pageNumber})` : "";
      lines.push(`- ${section.title}${page}`);
    }
    lines.push("");
  }
  for (const orphan of draft.orphanSections) {
    const page = orphan.pageNumber ? ` (p. ${orphan.pageNumber})` : "";
    lines.push(`- ${orphan.title}${page}`);
  }
  return lines.join("\n").trim();
}

function assembleBookIndexText(via: BookIndexLocateResult & { found: true }, body: string): string {
  const viaLine =
    via.via === "outline-locator"
      ? `_Origen: índice localizado por el marcador del PDF (páginas ${via.pageNumbers.join(", ")})._`
      : via.via === "outline-rich"
        ? `_Origen: jerarquía tomada de los marcadores del PDF._`
        : `_Origen: índice reconocido en las páginas ${via.pageNumbers.join(", ")}._`;
  return `${BOOK_INDEX_FUENTE_HEADER}\n\n${viaLine}\n\n${body}`.trim();
}

export interface BookIndexPipelineDeps {
  rasterizer?: RasterizerService;
  models: Pick<ModelDeps, "createIngestAdapter">;
  safetyClassifier: SafetyClassifier;
  checkIngestQuota: (
    cloudPageCount: number,
  ) => Promise<{ ok: true } | { ok: false; reason: "daily_ingest_pages" | "monthly_ingest_pages" | "cost_cap" }>;
  recordIngestUsage: (costUsd: number | null) => Promise<void>;
  /**
   * Existing `transcribeCloudPage` from pipeline.ts — reuse, do not fork a
   * vision path. `cloudDeps` is the quota/model/safety slice (same shape as
   * pipeline's `DigestMaterialPdfDeps`, without this function itself).
   */
  transcribeCloudPage: (
    pdfBytes: Uint8Array,
    pageNumberInBytes: number,
    originalPageNumber: number,
    subject: string | undefined,
    cloudDeps: {
      models: Pick<ModelDeps, "createIngestAdapter">;
      safetyClassifier: SafetyClassifier;
      recordIngestUsage: (costUsd: number | null) => Promise<void>;
      checkIngestQuota: BookIndexPipelineDeps["checkIngestQuota"];
      rasterizer?: RasterizerService;
    },
    rasterizer: RasterizerService,
  ) => Promise<CloudPageOutcome>;
}

/**
 * Digests a too-large PDF as its book index. Returns `not_found` when no
 * index can be located (caller throws `MaterialTooLargeError`).
 */
export async function digestLargePdfAsBookIndex(
  input: DigestLargePdfAsBookIndexInput,
  deps: BookIndexPipelineDeps,
): Promise<BookIndexDigestOutcome> {
  const locator = outlineToTocLocator(input.outline);

  // Pages we may need before deciding: locator window, or the leading prefix
  // for the heuristic path. Never the full 400+.
  let pagesToPeek: number[];
  if (locator.kind === "toc-page") {
    pagesToPeek = [];
    for (let i = 0; i < TOC_MAX_EXTRACT_PAGES; i++) {
      const p = locator.pageNumber + i;
      if (p >= 1 && p <= input.numPages) pagesToPeek.push(p);
    }
  } else if (locator.kind === "outline-rich") {
    pagesToPeek = [];
  } else {
    const limit = Math.min(TOC_PREFIX_SCAN_PAGES, input.numPages);
    pagesToPeek = Array.from({ length: limit }, (_, i) => i + 1);
  }

  const peeked =
    pagesToPeek.length > 0
      ? await parsePdfNode(input.pdfBytes, { pageNumbers: pagesToPeek })
      : { numPages: input.numPages, pages: [] as NormalizedPage[], outline: input.outline };

  const located = locateBookIndex({
    outline: input.outline,
    candidatePages: peeked.pages,
    numPages: input.numPages,
  });
  if (!located.found) return { kind: "not_found" };

  if (located.via === "outline-rich" && located.draftFromOutline) {
    const body = formatTemarioDraftMarkdown(located.draftFromOutline);
    if (!body) return { kind: "not_found" };
    return {
      kind: "ok",
      status: "ready",
      assembledText: assembleBookIndexText(located, body),
      processingReport: [{ page: null, route: "local", costUsd: 0, cached: false }],
    };
  }

  const needed = located.pageNumbers;
  const byNumber = new Map(peeked.pages.map((p) => [p.pageNumber, p]));
  const missing = needed.filter((n) => !byNumber.has(n));
  if (missing.length > 0) {
    const extra = await parsePdfNode(input.pdfBytes, { pageNumbers: missing });
    for (const page of extra.pages) byNumber.set(page.pageNumber, page);
  }

  const cloudNeeded: number[] = [];
  for (const n of needed) {
    const page = byNumber.get(n);
    if (!page || !pageHasUsableDigitalText(page)) cloudNeeded.push(n);
  }

  if (cloudNeeded.length > 0) {
    const quotaResult = await deps.checkIngestQuota(cloudNeeded.length);
    if (!quotaResult.ok) {
      return { kind: "quota_exceeded", reason: quotaResult.reason };
    }
  }

  const rasterizer = deps.rasterizer ?? new NapiCanvasRasterizerService();
  const report: MaterialProcessingEntry[] = [];
  const pageTexts: string[] = [];
  let anyFailed = false;

  for (const n of needed) {
    const page = byNumber.get(n);
    if (page && pageHasUsableDigitalText(page)) {
      pageTexts.push(pageTextToMarkdown(page));
      report.push({ page: n, route: "local", costUsd: 0, cached: false });
      continue;
    }

    const outcome = await deps.transcribeCloudPage(input.pdfBytes, n, n, input.subject, deps, rasterizer);
    pageTexts.push(outcome.text);
    report.push(cloudPageProcessingEntry(n, outcome));
    if (outcome.failed) anyFailed = true;
  }

  const entries = pageTexts.flatMap((t) => parseTocText(t));
  const draft = buildTemarioDraft(entries);
  const structured = formatTemarioDraftMarkdown(draft);
  const body =
    structured.length > 0
      ? structured
      : pageTexts
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .join("\n\n---\n\n");
  if (!body) return { kind: "not_found" };

  return {
    kind: "ok",
    status: anyFailed ? "partial" : "ready",
    assembledText: assembleBookIndexText(located, body),
    processingReport: report,
  };
}
