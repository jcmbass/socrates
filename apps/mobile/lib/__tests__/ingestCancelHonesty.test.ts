/**
 * beta-real 09 — cancel copy honesty + awaiting-server predicate.
 */
import { describe, expect, it } from "vitest";
import { ingestCancelLabel } from "../ingestStatusMessage";
import { IDLE_STATE, isIngestAwaitingServer, type IngestState } from "../materialIngestState";
import { t } from "../../i18n/es";

function stateFor(overrides: Partial<IngestState>): IngestState {
  return { ...IDLE_STATE, fileName: "guia.pdf", ...overrides };
}

describe("isIngestAwaitingServer (beta-real 09 P2)", () => {
  it("true in processing", () => {
    expect(isIngestAwaitingServer(stateFor({ phase: "processing" }))).toBe(true);
  });

  it("true when uploading bar is effectively full", () => {
    expect(isIngestAwaitingServer(stateFor({ phase: "uploading", uploadProgress: 1 }))).toBe(true);
    expect(isIngestAwaitingServer(stateFor({ phase: "uploading", uploadProgress: 0.999 }))).toBe(true);
  });

  it("false while bytes are still leaving the device", () => {
    expect(isIngestAwaitingServer(stateFor({ phase: "uploading", uploadProgress: 0.4 }))).toBe(false);
    expect(isIngestAwaitingServer(stateFor({ phase: "parsing" }))).toBe(false);
    expect(isIngestAwaitingServer(stateFor({ phase: "attaching" }))).toBe(false);
  });
});

describe("ingestCancelLabel (beta-real 09 P2a)", () => {
  it("says Cancelar before the server owns the work", () => {
    expect(ingestCancelLabel(stateFor({ phase: "parsing" }))).toBe(t.materialIngest.cancel);
    expect(ingestCancelLabel(stateFor({ phase: "uploading", uploadProgress: 0.5 }))).toBe(t.materialIngest.cancel);
  });

  it("says Dejar de esperar once processing started", () => {
    expect(ingestCancelLabel(stateFor({ phase: "processing" }))).toBe(t.materialIngest.stopWaiting);
    expect(ingestCancelLabel(stateFor({ phase: "uploading", uploadProgress: 1 }))).toBe(t.materialIngest.stopWaiting);
  });
});
