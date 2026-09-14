/**
 * Honest copy for a failed study turn.
 *
 * WHY THIS EXISTS — reported by the founder on the e13: sending a message
 * failed with "No se pudo enviar tu mensaje. Revisá tu conexión.", and his
 * connection was fine. The screen collapsed EVERY server error into that one
 * line (`err instanceof ApiError ? turnFailed : genericError`), so a tutor
 * provider outage was reported as the student's fault.
 *
 * The server already distinguishes them: when the tutor chain is exhausted
 * it answers `upstream_error` carrying the provider's own message
 * (`routes/sessions.ts`, "Tutor chain exhausted"). Only `network_error` —
 * synthesised client-side when no HTTP response ever arrived — actually
 * means the connection.
 *
 * Same family as the ingest bugs of 2026-07-29: an error blamed on the
 * network that never touched the network.
 */
import { getStrings } from "../i18n";
import { ApiError } from "./api/errors";

/** Message for the red banner above the composer. */
export function turnErrorCopy(err: unknown): string {
  // Active catalog at CALL time — see lib/ingestErrorCopy.ts's note.
  const t = getStrings();
  if (!(err instanceof ApiError)) return t.common.genericError;

  switch (err.code) {
    case "network_error":
      // The only case where the connection is genuinely the suspect.
      return t.study.turnFailedNetwork;
    case "upstream_error":
      // The tutor provider (not Anthropic-only — see the configured chain)
      // failed or is unreachable. Retrying is worth it; the student's
      // connection is not the problem and we must not say it is.
      return t.study.turnFailedTutor;
    case "duplicate_turn":
      // Llegar acá significa que la reconciliación por GET no encontró el
      // turno: sigue en vuelo. Pedir paciencia, no reenvío.
      return t.study.turnAlreadyInFlight;
    case "conflict":
      return t.study.turnFailedSessionClosed;
    case "internal_error":
      return t.study.turnFailedServer;
    default:
      return t.study.turnFailedServer;
  }
}

/** True when the failure is worth offering a retry for (vs. a dead end). */
export function turnErrorIsRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.code !== "conflict";
}
