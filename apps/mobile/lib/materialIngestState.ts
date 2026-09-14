/**
 * Material ingestion state machine — F2 WQ2 Part 2, "the #1 validated
 * friction": upload a guide mid-session WITHOUT losing the tutor thread
 * (`docs/plan-app-multiplataforma/05-plan-f2.md` Ola 2). PURE reducer (no
 * RN, no DOM) so the transitions — including the invariant that matters
 * most, "the chat NEVER becomes non-interactive because of ingestion" — are
 * offline-testable, per this repo's established pattern (`lib/vitest.config.ts`'s
 * module doc: "Nothing under test imports react-native... RN-dependent code
 * is exercised by the `expo export` bundling gate instead").
 *
 * DESIGN.md-driven UX shape (§6 "indicadores de progreso: línea fina,
 * puntos pequeños, contadores de paso — no spinners genéricos"): this
 * state's `steps`/`activePage` fields are what a thin per-page progress
 * line renders from; `blocksChat` is ALWAYS false by construction (there is
 * no state/action pair that sets it otherwise) — the screen wiring
 * (`components/MaterialIngestBar.tsx`) never disables `ChatComposer` based
 * on ingestion state, only reads `status` to decide what banner to show
 * alongside the (always-usable) chat.
 *
 * beta-real 07: `uploadProgress` (0–1) while bytes are measurable; null
 * once the request is waiting on server-side digest ("processing" copy
 * with the file name). No mute terminal — every path ends in done or error.
 */

import { isUploadEffectivelyDone } from "./api/uploadProgress";

export type IngestPhase =
  | "idle"
  | "picking"
  | "parsing"
  | "uploading"
  | "processing"
  | "attaching"
  /** Server already has the digest; client is attaching the missing Fuente. */
  | "reconciling"
  | "done"
  | "error";

export type IngestErrorKind =
  | "network"
  | "quota"
  | "safety"
  | "invalid_pdf"
  | "too_many_pages"
  | "raster_too_large"
  | "timeout"
  | "cancelled"
  /**
   * Reconcile saw `status: "failed"` on the material row. The server does
   * NOT persist an error code/reason on `material_assets` — only the
   * terminal status — so this is a client classification, not a mapped
   * API code. Live upload failures still use the specific kinds above.
   */
  | "digest_failed"
  | "unknown";

export interface PageStep {
  page: number;
  total: number;
  routeKind: string;
}

export interface IngestState {
  phase: IngestPhase;
  fileName: string | null;
  /** Most recent per-page progress report from the WebView bridge (parsing phase) — one thin step, per DESIGN.md §6, not a blocking modal. */
  step: PageStep | null;
  /**
   * Byte-level upload ratio (0–1) while `phase === "uploading"` and the
   * transport reports progress. `null` when progress is not measurable
   * (parsing / processing / attaching) — UI switches to the filename spinner.
   */
  uploadProgress: number | null;
  /** Non-null only in "error". Retryable unless kind is "cancelled" (student dismissed the picker — nothing to retry). */
  error: { kind: IngestErrorKind; message: string } | null;
  /** Non-null only in "done" — the attached MaterialAsset id, for the screen to surface "material listo" once. */
  materialId: string | null;
  /**
   * INVARIANT, not a UI toggle: always `false`. Kept as an explicit field
   * (rather than leaving "does ingestion block chat" implicit) so the test
   * suite can assert it stays false across EVERY reachable state — the
   * mechanical proof of the plan's "el chat del tutor permanece visible y
   * usable durante la ingesta" requirement.
   */
  blocksChat: false;
}

export const IDLE_STATE: IngestState = {
  phase: "idle",
  fileName: null,
  step: null,
  uploadProgress: null,
  error: null,
  materialId: null,
  blocksChat: false,
};

export type IngestAction =
  | { type: "PICK_STARTED" }
  | { type: "PICK_CANCELLED" }
  | { type: "FILE_PICKED"; fileName: string }
  | { type: "PARSE_PROGRESS"; page: number; total: number; routeKind: string }
  | { type: "PARSE_DONE" }
  | { type: "PARSE_FAILED"; message: string }
  | { type: "UPLOAD_STARTED" }
  | { type: "UPLOAD_PROGRESS"; ratio: number }
  | { type: "UPLOAD_WAITING" }
  | { type: "UPLOAD_FAILED"; kind: Exclude<IngestErrorKind, "cancelled">; message: string }
  | { type: "ATTACH_STARTED" }
  | { type: "ATTACH_SUCCEEDED"; materialId: string }
  | { type: "ATTACH_FAILED"; kind: Exclude<IngestErrorKind, "cancelled">; message: string }
  | { type: "RECONCILE_STARTED"; fileName: string }
  | { type: "RECONCILE_SUCCEEDED"; materialId: string }
  | { type: "RECONCILE_FAILED"; kind: Exclude<IngestErrorKind, "cancelled">; message: string }
  | { type: "PARSE_TIMEOUT"; message: string }
  | { type: "CANCEL" }
  | { type: "RETRY" }
  | { type: "DISMISS" };

export function ingestReducer(state: IngestState, action: IngestAction): IngestState {
  switch (action.type) {
    case "PICK_STARTED":
      return { ...IDLE_STATE, phase: "picking" };
    case "PICK_CANCELLED":
      return IDLE_STATE;
    case "FILE_PICKED":
      return { ...IDLE_STATE, phase: "parsing", fileName: action.fileName };
    case "PARSE_PROGRESS":
      return { ...state, phase: "parsing", step: { page: action.page, total: action.total, routeKind: action.routeKind } };
    case "PARSE_DONE":
      return { ...state, phase: "uploading", uploadProgress: 0 };
    case "PARSE_FAILED":
      return { ...state, phase: "error", error: { kind: "invalid_pdf", message: action.message }, uploadProgress: null };
    case "UPLOAD_STARTED":
      return { ...state, phase: "uploading", uploadProgress: state.uploadProgress ?? 0 };
    case "UPLOAD_PROGRESS":
      return {
        ...state,
        phase: "uploading",
        uploadProgress: Math.max(0, Math.min(1, action.ratio)),
      };
    case "UPLOAD_WAITING":
      // Bytes are on the wire; waiting on server raster/transcribe — no
      // measurable progress. Spinner + filename copy takes over.
      return { ...state, phase: "processing", uploadProgress: null };
    case "UPLOAD_FAILED":
      return { ...state, phase: "error", error: { kind: action.kind, message: action.message }, uploadProgress: null };
    case "ATTACH_STARTED":
      return { ...state, phase: "attaching", uploadProgress: null };
    case "ATTACH_SUCCEEDED":
      return { ...state, phase: "done", materialId: action.materialId, error: null, uploadProgress: null };
    case "ATTACH_FAILED":
      return { ...state, phase: "error", error: { kind: action.kind, message: action.message }, uploadProgress: null };
    case "RECONCILE_STARTED":
      return {
        ...IDLE_STATE,
        phase: "reconciling",
        fileName: action.fileName,
      };
    case "RECONCILE_SUCCEEDED":
      return { ...state, phase: "done", materialId: action.materialId, error: null, uploadProgress: null };
    case "RECONCILE_FAILED":
      return { ...state, phase: "error", error: { kind: action.kind, message: action.message }, uploadProgress: null };
    case "PARSE_TIMEOUT":
      return {
        ...state,
        phase: "error",
        error: { kind: "timeout", message: action.message },
        uploadProgress: null,
      };
    case "CANCEL":
      // Clean exit — student asked to stop. Not an error banner; back to idle
      // with the upload affordance re-enabled (beta-real 08 Fase 2).
      return IDLE_STATE;
    case "RETRY":
      // Retrying always starts a fresh pick — this app never caches a
      // parsed-but-not-uploaded PDF across a retry (C4 §3.5-style
      // discipline: no ad-hoc client cache of intermediate ingest state).
      return { ...IDLE_STATE, phase: "picking" };
    case "DISMISS":
      return IDLE_STATE;
    default:
      return state;
  }
}

/** True while ingestion is doing something the "subir guía" affordance shouldn't be re-triggerable for (picker already open, actively parsing/uploading/attaching). Distinct from `blocksChat`, which is NEVER true — this only gates the upload button itself. */
export function isIngestBusy(state: IngestState): boolean {
  return (
    state.phase === "picking" ||
    state.phase === "parsing" ||
    state.phase === "uploading" ||
    state.phase === "processing" ||
    state.phase === "attaching" ||
    state.phase === "reconciling"
  );
}

/**
 * Bytes are already on the server (or the UI treats them as such). Aborting
 * the XHR here does NOT stop raster/transcribe — it only throws away the
 * response. UI must say "Dejar de esperar", not "Cancelar" (beta-real 09).
 */
export function isIngestAwaitingServer(state: IngestState): boolean {
  if (state.phase === "processing") return true;
  if (state.phase === "uploading" && isUploadEffectivelyDone(state.uploadProgress)) return true;
  return false;
}
