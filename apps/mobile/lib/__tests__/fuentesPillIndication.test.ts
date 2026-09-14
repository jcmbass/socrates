/**
 * Header Fuentes pill — every busy phase must produce a visible/busy
 * indication (animate + non-empty status). Same root cause as beta-real 08
 * mute hang: two hand lists that drift.
 */
import { describe, expect, it } from "vitest";

import { t } from "../../i18n/es";
import { ingestBusyPhases } from "../ingestStatusMessage";
import {
  fuentesPillIndication,
  fuentesPillShouldAnimate,
} from "../fuentesPillIndication";
import { IDLE_STATE, isIngestBusy, type IngestPhase, type IngestState } from "../materialIngestState";

function stateFor(phase: IngestPhase, overrides: Partial<IngestState> = {}): IngestState {
  return {
    ...IDLE_STATE,
    phase,
    fileName: "guia.pdf",
    ...overrides,
  };
}

const ALL_PHASES: IngestPhase[] = [
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

describe("fuentesPillIndication — no mute busy phase", () => {
  it("animate tracks isIngestBusy for EVERY phase (single source)", () => {
    for (const phase of ALL_PHASES) {
      const state = stateFor(phase, phase === "error" ? { error: { kind: "network", message: "falló" } } : {});
      const indication = fuentesPillIndication(state, 3);
      expect(indication.animate, `phase=${phase}`).toBe(isIngestBusy(state));
      expect(fuentesPillShouldAnimate(state), `phase=${phase}`).toBe(isIngestBusy(state));
    }
  });

  it("every busy phase yields busy kind + non-empty statusMessage", () => {
    for (const phase of ingestBusyPhases()) {
      const state = stateFor(phase, phase === "uploading" ? { uploadProgress: null } : {});
      const indication = fuentesPillIndication(state, 0);
      expect(indication.kind, `phase=${phase}`).toBe("busy");
      if (indication.kind !== "busy") throw new Error("unreachable");
      expect(indication.statusMessage.length, `phase=${phase}`).toBeGreaterThan(0);
      expect(indication.a11yLabel).toContain(indication.statusMessage);
      expect(indication.animate).toBe(true);
    }
  });

  it("idle and done never animate (orb must not run at rest)", () => {
    expect(fuentesPillIndication(stateFor("idle"), 2).animate).toBe(false);
    expect(fuentesPillIndication(stateFor("done", { materialId: "f1" }), 2).animate).toBe(false);
    expect(fuentesPillIndication(stateFor("idle"), 2).kind).toBe("idle");
  });

  it("error is visible without animating", () => {
    const indication = fuentesPillIndication(
      stateFor("error", { error: { kind: "timeout", message: "Tardó demasiado en leerse el archivo." } }),
      1,
    );
    expect(indication.kind).toBe("error");
    expect(indication.animate).toBe(false);
    if (indication.kind !== "error") throw new Error("unreachable");
    expect(indication.errorMessage.length).toBeGreaterThan(0);
    expect(indication.a11yLabel.toLowerCase()).toContain("error");
  });

  it("digest_failed (reconcile of a server failed row) is a visible error, not the generic unknown", () => {
    const indication = fuentesPillIndication(
      stateFor("error", { error: { kind: "digest_failed", message: t.fuentes.errors.digestFailed } }),
      1,
    );
    expect(indication.kind).toBe("error");
    if (indication.kind !== "error") throw new Error("unreachable");
    expect(indication.errorMessage).toBe(t.fuentes.errors.digestFailed);
    expect(indication.errorMessage).not.toBe(t.fuentes.errors.unknown);
  });

  it("busy phase list used by the pill matches ingestBusyPhases exactly", () => {
    for (const phase of ALL_PHASES) {
      const busy = isIngestBusy(stateFor(phase));
      expect(busy).toBe(ingestBusyPhases().includes(phase));
    }
  });
});
