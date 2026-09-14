/**
 * Single source of truth for busy-state student copy (beta-real 08 Fase 1).
 *
 * `isIngestBusy` and the UI feedback MUST stay aligned — previously the
 * spinner/text covered fewer phases than the busy gate, so `parsing`
 * without a WebView progress event showed nothing while the button stayed
 * disabled. Every busy phase returns a non-empty message; the suite
 * asserts that mechanically.
 */
import { getStrings } from "../i18n";
import { truncateFileName } from "./materialIngest";
import { isIngestAwaitingServer, isIngestBusy, type IngestPhase, type IngestState } from "./materialIngestState";
import { isUploadEffectivelyDone } from "./api/uploadProgress";

const BUSY_PHASES: IngestPhase[] = [
  "picking",
  "parsing",
  "uploading",
  "processing",
  "attaching",
  "reconciling",
];

/** Phases where `isIngestBusy` is true — exported for the coverage test. */
export function ingestBusyPhases(): readonly IngestPhase[] {
  return BUSY_PHASES;
}

/**
 * True when the UI can draw a real progress bar (parse page step or upload
 * byte ratio). Otherwise show a spinner alongside the status message.
 */
export function hasMeasurableProgress(state: IngestState): boolean {
  if (state.phase === "parsing" && state.step && state.step.total > 0) return true;
  // A full bar is not progress any more — the wait moved to the server, so
  // hand over to the spinner even if the phase never advanced.
  if (state.phase === "uploading" && state.uploadProgress != null) {
    return !isUploadEffectivelyDone(state.uploadProgress);
  }
  return false;
}

/**
 * Student-facing status for ANY busy phase. Never returns "" while
 * `isIngestBusy(state)` is true.
 */
export function ingestStatusMessage(state: IngestState): string {
  if (!isIngestBusy(state)) return "";

  // Active catalog at CALL time — see lib/ingestErrorCopy.ts's note.
  const t = getStrings();
  switch (state.phase) {
    case "picking":
      return t.materialIngest.picking;
    case "parsing":
      if (state.step && state.step.total > 0) {
        return t.materialIngest.parsing
          .replace("{page}", String(state.step.page))
          .replace("{total}", String(state.step.total));
      }
      return t.materialIngest.preparing;
    case "uploading":
      // Full bar ⇒ the bytes are gone; claiming "Subiendo…" would be a lie
      // the student stares at for the whole server digest.
      if (isUploadEffectivelyDone(state.uploadProgress)) {
        return t.materialIngest.processing(truncateFileName(state.fileName ?? "PDF"));
      }
      if (state.uploadProgress != null) {
        return t.materialIngest.uploadingProgress(Math.round(state.uploadProgress * 100));
      }
      return t.materialIngest.uploading;
    case "processing":
      return t.materialIngest.processing(truncateFileName(state.fileName ?? "PDF"));
    case "attaching":
      return t.materialIngest.attaching;
    case "reconciling":
      return t.fuentes.recovering(truncateFileName(state.fileName ?? "PDF"));
    default:
      // New busy phase added to isIngestBusy without a case — still non-empty.
      return t.materialIngest.preparing;
  }
}

/** Width for the thin progress line when `hasMeasurableProgress` is true. */
export function ingestProgressWidth(state: IngestState): `${number}%` {
  if (state.phase === "parsing" && state.step && state.step.total > 0) {
    return `${Math.round((state.step.page / state.step.total) * 100)}%`;
  }
  if (state.phase === "uploading" && state.uploadProgress != null) {
    return `${Math.round(state.uploadProgress * 100)}%`;
  }
  return "100%";
}

/** Cancel vs "Dejar de esperar" — honest once the server owns the work (09 P2a). */
export function ingestCancelLabel(state: IngestState): string {
  const t = getStrings();
  return isIngestAwaitingServer(state) ? t.materialIngest.stopWaiting : t.materialIngest.cancel;
}
