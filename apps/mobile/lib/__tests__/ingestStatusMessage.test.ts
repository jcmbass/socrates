/**
 * beta-real 08 Fase 1 — every busy phase must have non-empty student copy.
 */
import { describe, expect, it } from "vitest";
import {
  hasMeasurableProgress,
  ingestBusyPhases,
  ingestStatusMessage,
} from "../ingestStatusMessage";
import { IDLE_STATE, isIngestBusy, type IngestPhase, type IngestState } from "../materialIngestState";
import { shouldSkipWebViewParse, CLIENT_WEBVIEW_MAX_BYTES } from "../materialIngestLimits";

function stateFor(phase: IngestPhase, overrides: Partial<IngestState> = {}): IngestState {
  return {
    ...IDLE_STATE,
    phase,
    fileName: "The_Distributed_Node.pdf",
    ...overrides,
  };
}

describe("ingestStatusMessage — no mute busy phase (beta-real 08)", () => {
  it("busy phase list matches isIngestBusy exactly", () => {
    const phases: IngestPhase[] = [
      "idle",
      "picking",
      "parsing",
      "uploading",
      "processing",
      "attaching",
      "reconciling",
      "done",
      "error",
    ];
    for (const phase of phases) {
      expect(isIngestBusy(stateFor(phase))).toBe(ingestBusyPhases().includes(phase));
    }
  });

  it("returns a non-empty message for EVERY busy phase (including parsing without step)", () => {
    for (const phase of ingestBusyPhases()) {
      const state = stateFor(phase, phase === "uploading" ? { uploadProgress: null } : {});
      const message = ingestStatusMessage(state);
      expect(message.length, `phase=${phase}`).toBeGreaterThan(0);
    }
  });

  it("parsing without step says Preparando tu archivo… (the mute hang case)", () => {
    expect(ingestStatusMessage(stateFor("parsing", { step: null }))).toBe("Preparando tu archivo…");
  });

  it("parsing with step shows page progress", () => {
    const msg = ingestStatusMessage(
      stateFor("parsing", { step: { page: 2, total: 15, routeKind: "cloud-page" } }),
    );
    expect(msg).toContain("2");
    expect(msg).toContain("15");
  });

  it("spinner vs bar: measurable only for parse step or upload ratio", () => {
    expect(hasMeasurableProgress(stateFor("parsing", { step: null }))).toBe(false);
    expect(hasMeasurableProgress(stateFor("parsing", { step: { page: 1, total: 3, routeKind: "local-text" } }))).toBe(true);
    expect(hasMeasurableProgress(stateFor("uploading", { uploadProgress: 0.4 }))).toBe(true);
    expect(hasMeasurableProgress(stateFor("processing"))).toBe(false);
  });
});

describe("shouldSkipWebViewParse (beta-real 08 Option B)", () => {
  it("skips the bridge for The_Distributed_Node-sized PDFs", () => {
    expect(shouldSkipWebViewParse(15_484_819)).toBe(true);
    expect(shouldSkipWebViewParse(CLIENT_WEBVIEW_MAX_BYTES)).toBe(false);
    expect(shouldSkipWebViewParse(CLIENT_WEBVIEW_MAX_BYTES + 1)).toBe(true);
    expect(shouldSkipWebViewParse(174_000)).toBe(false);
  });
});

describe("barra llena ⇒ nunca dice 'Subiendo' (beta-real 08, e13)", () => {
  it("con la subida al 100% muestra que se está procesando, no subiendo", () => {
    const msg = ingestStatusMessage(stateFor("uploading", { uploadProgress: 1 }));
    expect(msg).not.toContain("Subiendo");
    expect(msg).toContain("procesando");
  });

  it("con la barra llena el progreso deja de ser medible ⇒ aparece el spinner", () => {
    expect(hasMeasurableProgress(stateFor("uploading", { uploadProgress: 1 }))).toBe(false);
    expect(hasMeasurableProgress(stateFor("uploading", { uploadProgress: 0.4 }))).toBe(true);
  });
});
