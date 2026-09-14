/**
 * Single source of truth for the header "Fuentes" pill indication while a
 * PDF is ingesting in the background (modal closed).
 *
 * Derives from the SAME busy gate as `isIngestBusy` / `ingestStatusMessage`
 * — never a hand-maintained second list of phases. The suite walks every
 * phase and fails if a busy one would leave the pill mute or idle.
 */
import { getStrings } from "../i18n";
import { ingestStatusMessage } from "./ingestStatusMessage";
import { isIngestBusy, type IngestState } from "./materialIngestState";

export type FuentesPillIndication =
  | {
      kind: "idle";
      /** Orb must NOT animate. */
      animate: false;
      label: string;
      a11yLabel: string;
    }
  | {
      kind: "busy";
      animate: true;
      label: string;
      /** Same copy the modal/bar would show — never empty while busy. */
      statusMessage: string;
      a11yLabel: string;
    }
  | {
      kind: "error";
      animate: false;
      label: string;
      errorMessage: string;
      a11yLabel: string;
    };

/**
 * What the header Fuentes pill should show for this ingest state.
 * `animate === true` only while `isIngestBusy` — the orb mounts solely then.
 */
export function fuentesPillIndication(state: IngestState, count: number): FuentesPillIndication {
  // Active catalog at CALL time — see lib/ingestErrorCopy.ts's note.
  const t = getStrings();
  if (isIngestBusy(state)) {
    const statusMessage = ingestStatusMessage(state);
    return {
      kind: "busy",
      animate: true,
      label: t.fuentes.buttonLabel,
      statusMessage,
      a11yLabel: t.fuentes.buttonA11yLabelBusy(statusMessage),
    };
  }

  if (state.phase === "error" && state.error) {
    const errorMessage = state.error.message.trim() || t.fuentes.errors.unknown;
    return {
      kind: "error",
      animate: false,
      label: t.fuentes.buttonLabel,
      errorMessage,
      a11yLabel: t.fuentes.buttonA11yLabelError(errorMessage),
    };
  }

  return {
    kind: "idle",
    animate: false,
    label: t.fuentes.buttonLabel,
    a11yLabel: t.fuentes.buttonA11yLabel(count),
  };
}

/** True only when the ThinkingOrb may run a pulse (and should be mounted). */
export function fuentesPillShouldAnimate(state: IngestState): boolean {
  return fuentesPillIndication(state, 0).animate;
}
