/**
 * Test-only helper (F2 WQ2 Part 1): builds independently-valid single-page
 * PDF extracts from an existing multi-page fixture, the same encoding
 * subset-mode uploads use (`../materials/pipeline.ts`'s module doc —
 * "single-page PDFs extracted client-side"). `pdf-lib` is a devDependency
 * ONLY (apps/server never needs to WRITE a PDF in production — parsing is
 * `pdfjs-dist`'s job); this mirrors what `apps/mobile`'s WebView-bridge
 * does client-side (F2 WQ2 Part 2), letting these tests exercise the real
 * server contract without needing a running mobile client.
 */
import { PDFDocument } from "pdf-lib";

/** Extracts ONE page (1-based `pageNumber`) from `sourceBytes` into a standalone single-page PDF's bytes. */
export async function extractSinglePagePdf(sourceBytes: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(sourceBytes);
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(src, [pageNumber - 1]);
  out.addPage(copied);
  return out.save();
}
