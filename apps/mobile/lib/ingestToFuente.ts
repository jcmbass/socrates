/**
 * Pure post-parse step of the "Subir PDF → Fuente" pipeline (beta-real 05):
 * upload subset pages → `attachSource` with extracted text only (DF-P10).
 *
 * Kept free of react-native so vitest can cover the chain without RN.
 * The WebView pick/parse host lives in `components/useIngestToFuente.tsx`
 * and calls this once it has an `IngestResult`.
 */
import type { ApiClient } from "./api/client";
import type { Fuente } from "./api/types";
import {
  buildSubsetUploadPlan,
  classifyIngestError,
  exceedsMaxPagesPerRequest,
} from "./materialIngest";
import { MAX_PAGES_PER_REQUEST } from "./materialIngestLimits";
import type { IngestResult } from "./materialIngestBridge";
import type { IngestErrorKind } from "./materialIngestState";

export type IngestToFuenteClient = Pick<ApiClient, "uploadMaterialSubset" | "attachSource">;

export type IngestToFuenteOk = { ok: true; fuente: Fuente };
export type IngestToFuenteErr = {
  ok: false;
  kind: Exclude<IngestErrorKind, "cancelled">;
  message: string;
};

export type IngestToFuenteResult = IngestToFuenteOk | IngestToFuenteErr;

/**
 * Upload cloud pages (if any), then create a subject-scoped Fuente from the
 * digested text. Does NOT call `generateTemario` — that is a separate step
 * (`lib/pdfToTemario.ts`) so SourcesModal can stop at Fuente.
 */
export async function attachFuenteFromIngestResult(
  client: IngestToFuenteClient,
  token: string,
  subjectId: string,
  result: IngestResult,
): Promise<IngestToFuenteResult> {
  if (exceedsMaxPagesPerRequest(result.totalPages)) {
    return {
      ok: false,
      kind: "too_many_pages",
      message: `${result.totalPages} pages exceeds the ${MAX_PAGES_PER_REQUEST}-page limit per upload`,
    };
  }

  const plan = buildSubsetUploadPlan(subjectId, result);
  let extractedText: string;
  try {
    const material = await client.uploadMaterialSubset(token, plan);
    extractedText = material.digestedTextRef;
  } catch (err) {
    const classified = classifyIngestError(err);
    return { ok: false, kind: classified.kind, message: classified.message };
  }

  try {
    const fuente = await client.attachSource(token, subjectId, {
      name: result.fileName,
      kind: "pdf",
      text: extractedText,
    });
    return { ok: true, fuente };
  } catch (err) {
    const classified = classifyIngestError(err);
    return { ok: false, kind: classified.kind, message: classified.message };
  }
}
