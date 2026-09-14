/**
 * Pure orchestration: IngestResult → Fuente → temario (beta-real 05).
 *
 * Stages the UI should surface (honest progress, not a mute spinner):
 *   reading  — upload + attachSource ("Leyendo tu programa…")
 *   building — generateTemario ("Armando tu temario…")
 *
 * If `attachSource` fails, generate is NEVER called.
 * If generate fails after Fuente was created, the Fuente id is returned so
 * the student can retry generation without re-uploading the PDF.
 */
import type { ApiClient } from "./api/client";
import type { Fuente, Temario } from "./api/types";
import { ApiError, isNetworkError, isQuotaExceeded } from "./api/errors";
import { attachFuenteFromIngestResult, type IngestToFuenteClient } from "./ingestToFuente";
import type { IngestResult } from "./materialIngestBridge";
import type { IngestErrorKind } from "./materialIngestState";

export type PdfToTemarioClient = IngestToFuenteClient & Pick<ApiClient, "generateTemario">;

export type PdfToTemarioStage = "reading" | "building";

export type PdfToTemarioErrorKind =
  | Exclude<IngestErrorKind, "cancelled">
  | "generate_failed";

export type PdfToTemarioOk = {
  ok: true;
  fuente: Fuente;
  temario: Temario;
  generatedBy: string;
};

export type PdfToTemarioErr = {
  ok: false;
  kind: PdfToTemarioErrorKind;
  message: string;
  /** Non-null when the Fuente was saved but generation failed — retry without re-upload. */
  fuenteId: string | null;
  fuente: Fuente | null;
};

export type PdfToTemarioResult = PdfToTemarioOk | PdfToTemarioErr;

export type PdfToTemarioProgress = (stage: PdfToTemarioStage) => void;

function classifyGenerateError(err: unknown): { kind: PdfToTemarioErrorKind; message: string } {
  if (isQuotaExceeded(err)) return { kind: "quota", message: err.message };
  if (isNetworkError(err)) return { kind: "network", message: err.message };
  if (err instanceof ApiError) return { kind: "generate_failed", message: err.message };
  return { kind: "generate_failed", message: err instanceof Error ? err.message : String(err) };
}

/**
 * Full chain after the WebView finished parsing. Calls `onProgress` before
 * each network stage so the UI can swap copy.
 */
export async function buildTemarioFromIngestResult(
  client: PdfToTemarioClient,
  token: string,
  subjectId: string,
  result: IngestResult,
  onProgress?: PdfToTemarioProgress,
): Promise<PdfToTemarioResult> {
  onProgress?.("reading");
  const attached = await attachFuenteFromIngestResult(client, token, subjectId, result);
  if (!attached.ok) {
    return {
      ok: false,
      kind: attached.kind,
      message: attached.message,
      fuenteId: null,
      fuente: null,
    };
  }

  return generateTemarioKeepingFuente(client, token, subjectId, attached.fuente, onProgress);
}

/** Retry generation for a Fuente that already exists (generate failed earlier). */
export async function retryGenerateTemarioFromFuente(
  client: Pick<ApiClient, "generateTemario">,
  token: string,
  subjectId: string,
  fuente: Fuente,
  onProgress?: PdfToTemarioProgress,
): Promise<PdfToTemarioResult> {
  return generateTemarioKeepingFuente(client, token, subjectId, fuente, onProgress);
}

async function generateTemarioKeepingFuente(
  client: Pick<ApiClient, "generateTemario">,
  token: string,
  subjectId: string,
  fuente: Fuente,
  onProgress?: PdfToTemarioProgress,
): Promise<PdfToTemarioResult> {
  onProgress?.("building");
  try {
    const generated = await client.generateTemario(token, subjectId, fuente.id);
    return {
      ok: true,
      fuente,
      temario: generated.temario,
      generatedBy: generated.generatedBy,
    };
  } catch (err) {
    const classified = classifyGenerateError(err);
    return {
      ok: false,
      kind: classified.kind,
      message: classified.message,
      fuenteId: fuente.id,
      fuente,
    };
  }
}
