/**
 * SessionOpening — proactive tutor first message for an empty topic session.
 *
 * Separate from `Exchange` on purpose: an opening has no student utterance.
 * Persisting it as an Exchange would require fabricating `studentMessage`
 * (forbidden). One row per session; retries return the same row.
 */
import { z } from "zod";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

export const SESSION_OPENING_GROUNDINGS = ["fuentes", "general"] as const;
export type SessionOpeningGrounding = (typeof SESSION_OPENING_GROUNDINGS)[number];

export function parseSessionOpeningGrounding(value: unknown): SessionOpeningGrounding | null {
  const parsed = z.enum(SESSION_OPENING_GROUNDINGS).safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface SessionOpening {
  id: string;
  /** FK StudySession.id — unique. */
  sessionId: string;
  userId: string;
  /** Tutor-authored opening text shown via TutorMessage. @sensitive */
  text: string;
  tutorPromptVersion: string;
  tutorModelId: string;
  tutorProviderId: string;
  /**
   * How the opening was grounded: subject's Fuentes (`fuentes`) or topic
   * title / general knowledge only (`general`).
   */
  grounding: SessionOpeningGrounding;
  createdAt: string;
  schemaVersion: number;
}

export const SessionOpeningSchema: z.ZodType<SessionOpening> = z.object({
  id: idSchema,
  sessionId: idSchema,
  userId: idSchema,
  text: z.string().min(1),
  tutorPromptVersion: z.string().min(1),
  tutorModelId: z.string().min(1),
  tutorProviderId: z.string().min(1),
  grounding: z.enum(SESSION_OPENING_GROUNDINGS),
  createdAt: isoTimestampSchema,
  schemaVersion: schemaVersionSchema,
});
