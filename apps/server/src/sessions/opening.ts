/**
 * Helpers for the tutor opening call — instruction + grounding, no I/O.
 * The route still runs the real tutorAdapter + buildTopicSessionContext.
 */
import { SESSION_OPENING_USER_INSTRUCTION } from "@buxo/core/prompts";
import type { SessionOpeningGrounding } from "@buxo/domain/session-opening";

/** Fuentes grounding only when Fuente body text actually made it into context. */
export function resolveOpeningGrounding(input: { includedFuentesText: boolean }): SessionOpeningGrounding {
  return input.includedFuentesText ? "fuentes" : "general";
}

/** Single user-role instruction. Not a student utterance. */
export function buildOpeningTutorMessages(): Array<{ role: "user"; content: string }> {
  return [{ role: "user", content: SESSION_OPENING_USER_INSTRUCTION }];
}

/**
 * Opening is a tutor-authored assistant turn with no student utterance.
 * Prepend it so the next POST /exchanges sees the diagnostic question.
 */
export function prependOpeningToTutorMessages(
  openingText: string | null | undefined,
  priorExchanges: ReadonlyArray<{ studentMessage: string; tutorReply: string }>,
  studentMessage: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  const opening = openingText?.trim();
  if (opening) messages.push({ role: "assistant", content: opening });
  for (const ex of priorExchanges) {
    messages.push({ role: "user", content: ex.studentMessage });
    messages.push({ role: "assistant", content: ex.tutorReply });
  }
  messages.push({ role: "user", content: studentMessage });
  return messages;
}
