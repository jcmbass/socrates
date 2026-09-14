import { describe, expect, it } from "vitest";
import {
  IDLE_STATE,
  ingestReducer,
  isIngestBusy,
  type IngestAction,
  type IngestState,
} from "../materialIngestState";

function run(actions: IngestAction[], initial: IngestState = IDLE_STATE): IngestState {
  return actions.reduce(ingestReducer, initial);
}

describe("materialIngestState — F2 WQ2 Part 2 pure ingestion state machine", () => {
  it("starts idle, not busy", () => {
    expect(IDLE_STATE.phase).toBe("idle");
    expect(isIngestBusy(IDLE_STATE)).toBe(false);
  });

  it("happy path: pick -> file picked -> parse progress -> parse done -> upload -> attach -> done", () => {
    const state = run([
      { type: "PICK_STARTED" },
      { type: "FILE_PICKED", fileName: "guia1.pdf" },
      { type: "PARSE_PROGRESS", page: 1, total: 3, routeKind: "local-text" },
      { type: "PARSE_PROGRESS", page: 2, total: 3, routeKind: "cloud-page" },
      { type: "PARSE_DONE" },
      { type: "UPLOAD_STARTED" },
      { type: "ATTACH_STARTED" },
      { type: "ATTACH_SUCCEEDED", materialId: "mat-1" },
    ]);
    expect(state.phase).toBe("done");
    expect(state.materialId).toBe("mat-1");
    expect(state.fileName).toBe("guia1.pdf");
    expect(state.error).toBeNull();
  });

  it("PICK_CANCELLED resets to idle with no error (student dismissed the picker, not a failure)", () => {
    const state = run([{ type: "PICK_STARTED" }, { type: "PICK_CANCELLED" }]);
    expect(state).toEqual(IDLE_STATE);
  });

  it("progress states expose the current per-page step for a thin progress line (DESIGN.md §6)", () => {
    const state = run([
      { type: "PICK_STARTED" },
      { type: "FILE_PICKED", fileName: "guia1.pdf" },
      { type: "PARSE_PROGRESS", page: 2, total: 3, routeKind: "cloud-page" },
    ]);
    expect(state.step).toEqual({ page: 2, total: 3, routeKind: "cloud-page" });
    expect(isIngestBusy(state)).toBe(true);
  });

  it("tracks upload progress then switches to processing when waiting on the server", () => {
    const state = run([
      { type: "PICK_STARTED" },
      { type: "FILE_PICKED", fileName: "guia1.pdf" },
      { type: "PARSE_DONE" },
      { type: "UPLOAD_STARTED" },
      { type: "UPLOAD_PROGRESS", ratio: 0.4 },
      { type: "UPLOAD_WAITING" },
    ]);
    expect(state.phase).toBe("processing");
    expect(state.uploadProgress).toBeNull();
    expect(state.fileName).toBe("guia1.pdf");
    expect(isIngestBusy(state)).toBe(true);
  });

  it("UPLOAD_FAILED with kind=too_many_pages is a terminal error (never mute)", () => {
    const state = run([
      { type: "PICK_STARTED" },
      { type: "FILE_PICKED", fileName: "big.pdf" },
      { type: "UPLOAD_FAILED", kind: "too_many_pages", message: "too many pages" },
    ]);
    expect(state.phase).toBe("error");
    expect(state.error?.kind).toBe("too_many_pages");
    expect(isIngestBusy(state)).toBe(false);
  });

  it("PARSE_TIMEOUT lands in error with kind=timeout and re-enables the button", () => {
    const state = run([
      { type: "PICK_STARTED" },
      { type: "FILE_PICKED", fileName: "hung.pdf" },
      { type: "PARSE_TIMEOUT", message: "Tardó demasiado" },
    ]);
    expect(state.phase).toBe("error");
    expect(state.error?.kind).toBe("timeout");
    expect(isIngestBusy(state)).toBe(false);
  });

  it("CANCEL from any busy phase returns to clean idle", () => {
    const busy = run([
      { type: "PICK_STARTED" },
      { type: "FILE_PICKED", fileName: "guia1.pdf" },
      { type: "PARSE_PROGRESS", page: 1, total: 3, routeKind: "cloud-page" },
    ]);
    expect(isIngestBusy(busy)).toBe(true);
    const cancelled = ingestReducer(busy, { type: "CANCEL" });
    expect(cancelled).toEqual(IDLE_STATE);
    expect(isIngestBusy(cancelled)).toBe(false);
  });

  it("quota error: UPLOAD_FAILED with kind=quota lands in error state, retryable", () => {
    const state = run([
      { type: "PICK_STARTED" },
      { type: "FILE_PICKED", fileName: "guia1.pdf" },
      { type: "PARSE_DONE" },
      { type: "UPLOAD_STARTED" },
      { type: "UPLOAD_FAILED", kind: "quota", message: "Ingest quota exceeded" },
    ]);
    expect(state.phase).toBe("error");
    expect(state.error).toEqual({ kind: "quota", message: "Ingest quota exceeded" });
  });

  it("safety error: ATTACH_FAILED with kind=safety lands in error state", () => {
    const state = run([
      { type: "PICK_STARTED" },
      { type: "FILE_PICKED", fileName: "guia1.pdf" },
      { type: "PARSE_DONE" },
      { type: "UPLOAD_STARTED" },
      { type: "ATTACH_STARTED" },
      { type: "ATTACH_FAILED", kind: "safety", message: "Material transcription blocked" },
    ]);
    expect(state.phase).toBe("error");
    expect(state.error?.kind).toBe("safety");
  });

  it("network error during parse (malformed/corrupt PDF) surfaces as invalid_pdf", () => {
    const state = run([
      { type: "PICK_STARTED" },
      { type: "FILE_PICKED", fileName: "corrupt.pdf" },
      { type: "PARSE_FAILED", message: "Uploaded file is not a valid PDF" },
    ]);
    expect(state.phase).toBe("error");
    expect(state.error?.kind).toBe("invalid_pdf");
  });

  it("RETRY from an error state re-opens the picker, clearing the previous error", () => {
    const errored = run([
      { type: "PICK_STARTED" },
      { type: "FILE_PICKED", fileName: "guia1.pdf" },
      { type: "PARSE_DONE" },
      { type: "UPLOAD_STARTED" },
      { type: "UPLOAD_FAILED", kind: "network", message: "network down" },
    ]);
    const retried = ingestReducer(errored, { type: "RETRY" });
    expect(retried.phase).toBe("picking");
    expect(retried.error).toBeNull();
  });

  it("DISMISS from any state returns to idle", () => {
    const busy = run([{ type: "PICK_STARTED" }, { type: "FILE_PICKED", fileName: "guia1.pdf" }, { type: "PARSE_DONE" }]);
    expect(ingestReducer(busy, { type: "DISMISS" })).toEqual(IDLE_STATE);
  });

  it("invariant: blocksChat is false in EVERY reachable state (chat stays interactive during ingestion, per the plan's #1 requirement)", () => {
    const actionSequences: IngestAction[][] = [
      [],
      [{ type: "PICK_STARTED" }],
      [{ type: "PICK_STARTED" }, { type: "PICK_CANCELLED" }],
      [{ type: "PICK_STARTED" }, { type: "FILE_PICKED", fileName: "a.pdf" }],
      [{ type: "PICK_STARTED" }, { type: "FILE_PICKED", fileName: "a.pdf" }, { type: "PARSE_PROGRESS", page: 1, total: 2, routeKind: "local-text" }],
      [{ type: "PICK_STARTED" }, { type: "FILE_PICKED", fileName: "a.pdf" }, { type: "PARSE_DONE" }],
      [{ type: "PICK_STARTED" }, { type: "FILE_PICKED", fileName: "a.pdf" }, { type: "PARSE_DONE" }, { type: "UPLOAD_STARTED" }],
      [
        { type: "PICK_STARTED" },
        { type: "FILE_PICKED", fileName: "a.pdf" },
        { type: "PARSE_DONE" },
        { type: "UPLOAD_STARTED" },
        { type: "ATTACH_STARTED" },
      ],
      [
        { type: "PICK_STARTED" },
        { type: "FILE_PICKED", fileName: "a.pdf" },
        { type: "PARSE_DONE" },
        { type: "UPLOAD_STARTED" },
        { type: "ATTACH_STARTED" },
        { type: "ATTACH_SUCCEEDED", materialId: "m1" },
      ],
      [{ type: "PICK_STARTED" }, { type: "FILE_PICKED", fileName: "a.pdf" }, { type: "PARSE_FAILED", message: "bad" }],
      [
        { type: "PICK_STARTED" },
        { type: "FILE_PICKED", fileName: "a.pdf" },
        { type: "PARSE_DONE" },
        { type: "UPLOAD_STARTED" },
        { type: "UPLOAD_FAILED", kind: "quota", message: "x" },
      ],
    ];

    for (const actions of actionSequences) {
      const finalState = run(actions);
      expect(finalState.blocksChat).toBe(false);
      // Also check every INTERMEDIATE state along the way, not just the final one.
      let state = IDLE_STATE;
      for (const action of actions) {
        state = ingestReducer(state, action);
        expect(state.blocksChat).toBe(false);
      }
    }
  });
});
