/**
 * Upload progress bookkeeping for the XHR materials upload.
 *
 * WHY THIS EXISTS — observed on the moto e13: the bar reached 100% and then
 * the screen sat on "Subiendo… 100%" for the whole server-side raster +
 * transcribe, with no spinner and no honest copy. The student is told the
 * upload is still running when in fact the wait is the server's.
 *
 * Cause: React Native's XMLHttpRequest dispatches ONLY a `progress` event on
 * `xhr.upload` (`__didUploadProgress`, Libraries/Network/XMLHttpRequest.js).
 * It never dispatches `load` there — the `load` it emits belongs to the
 * response, and by then the server is already done. So `xhr.upload.onload`
 * is dead code on this platform and the "bytes are on the wire" transition
 * never fired.
 *
 * The only reliable signal is the progress event that reports
 * `loaded >= total`.
 */

export interface UploadProgressUpdate {
  /** Clamped ratio in [0, 1] for the progress bar. */
  ratio: number;
  /** True once the body finished leaving the device — hand over to the spinner. */
  finished: boolean;
}

/**
 * A ratio at or above this counts as "the body is gone".
 *
 * Not `=== 1`: on the e13 the bar reached a rounded 100% and the transition
 * still never fired, so the exact `loaded === total` event either does not
 * arrive or does not survive the trip to JS. The last thousandth of the
 * bytes is never the wait a student perceives — treating it as done is
 * honest; waiting for an event that may never come is not.
 */
export const UPLOAD_COMPLETE_RATIO = 0.999;

/** null when the event carries no usable total (nothing to draw). */
export function uploadProgressUpdate(loaded: number, total: number): UploadProgressUpdate | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(loaded) || loaded < 0) return null;
  const ratio = Math.max(0, Math.min(1, loaded / total));
  return { ratio, finished: loaded >= total || ratio >= UPLOAD_COMPLETE_RATIO };
}

/**
 * Belt and braces for the UI: a full bar must NEVER read "Subiendo…".
 *
 * The event-driven transition above is the primary path, but it depends on
 * React Native delivering a final progress event. This predicate depends on
 * nothing — if the bar is full, the wait belongs to the server, whatever
 * events did or did not arrive.
 */
export function isUploadEffectivelyDone(uploadProgress: number | null): boolean {
  return uploadProgress != null && uploadProgress >= UPLOAD_COMPLETE_RATIO;
}
