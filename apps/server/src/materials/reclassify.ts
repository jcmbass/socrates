/**
 * Server-side page re-classification — F2 WQ1 Part 1, plan risk #2
 * ("Doble parse ... el server nunca confía en la clasificación del cliente
 * — re-clasificar server-side la página recibida es barato y cierra el
 * hueco [de abuso de cuota]").
 *
 * Pure orchestration over the already-pure pieces in `../pdf/`: parses the
 * UPLOADED PDF bytes with `parsePdfNode` and re-derives each page's route
 * with the verbatim-ported `classifyPage` — never trusting whatever tier
 * the client claimed when it uploaded. A page the server classifies as
 * `local-text`/`local-text-with-figures` gets its text extracted HERE
 * (cheap, no model call) rather than rasterized/transcribed — this is what
 * closes the quota-abuse hole: a client cannot force a paid transcription
 * call by mislabeling an easy page as cloud-tier.
 *
 * What this module does NOT do: call the rasterizer or the ingest model —
 * those are `../raster/rasterizer.ts` and `../models/ingest.ts`,
 * orchestrated together with this module's output by `./pipeline.ts`
 * (F2 WQ1 Part 2). Kept separate so the re-classification decision itself
 * is unit-testable with zero I/O beyond reading the PDF bytes already in
 * hand — no rasterizer, no model, no network.
 */
import { parsePdfNode } from "../pdf/parse-node";
import { classifyPage, DEFAULT_THRESHOLDS, type PageRoute } from "@buxo/pdf/classify";
import { pageTextToMarkdown } from "@buxo/pdf/pageText";

export interface ReclassifiedPage {
  /** 1-based position within the UPLOADED pdf bytes (not necessarily the student's original document numbering — the caller maps that, see ./pipeline.ts). */
  uploadedPageNumber: number;
  /** The server's OWN classification — authoritative, never the client's claim. */
  route: PageRoute;
  /**
   * Non-null only for `local-text`/`local-text-with-figures` routes: the
   * page's text, extracted server-side, $0 cost. `null` for `cloud-page` —
   * the caller (./pipeline.ts) must rasterize + transcribe it.
   *
   * A `local-text-with-figures` page's individual embedded figures are NOT
   * transcribed here — `localText` is just the page's own prose. Content-
   * bearing figures should already have been routed to `cloud-page`
   * (`CONTENT_FIGURE_AREA_RATIO` in classify.ts); this tier is for small
   * decorative images only.
   */
  localText: string | null;
}

export interface ReclassifyResult {
  numPages: number;
  pages: ReclassifiedPage[];
}

/** Re-parses and re-classifies every page of `pdfBytes` — the server's single source of truth for tier routing, independent of any client claim. */
export async function reclassifyUploadedPdf(pdfBytes: Uint8Array): Promise<ReclassifyResult> {
  const parsed = await parsePdfNode(pdfBytes);

  const pages: ReclassifiedPage[] = parsed.pages.map((page) => {
    const classification = classifyPage(page, DEFAULT_THRESHOLDS);
    const isLocal = classification.route.kind !== "cloud-page";
    return {
      uploadedPageNumber: page.pageNumber,
      route: classification.route,
      localText: isLocal ? pageTextToMarkdown(page) : null,
    };
  });

  return { numPages: parsed.numPages, pages };
}
