/**
 * ChallengeDefinition / Achievement / Streak — B3-modelo-de-dominio.md
 * §2.11.
 *
 * `ChallengeScope` is a value object (discriminated union) embedded in
 * `ChallengeDefinition`. `criteria` is deliberately `unknown` — B2 owns its
 * shape (novelty/difficulty economy, O-7); B3 only reserves the field, and
 * this package does the same (no attempt to narrow it).
 */
import { z } from "zod";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";
import type { MasteryTier } from "./mastery";

export type ChallengeScope =
  | { kind: "subject"; subjectId: string }
  | { kind: "topic"; subjectId: string; topicKey: string }
  | { kind: "generic" };

export const ChallengeScopeSchema: z.ZodType<ChallengeScope> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subject"), subjectId: idSchema }),
  z.object({ kind: z.literal("topic"), subjectId: idSchema, topicKey: z.string() }),
  z.object({ kind: z.literal("generic") }),
]);

export interface ChallengeDefinition {
  id: string;
  scope: ChallengeScope;
  /** i18n */
  titleKey: string;
  /** i18n */
  descriptionKey: string;
  /**
   * Versionado como un prompt: un cambio de criterio es una versión NUEVA;
   * los Achievement ya otorgados conservan la versión con la que se
   * ganaron (ver Achievement.challengeDefinitionVersion).
   */
  version: string;
  /** OPAQUE — B2 es dueño de la forma. B3 solo reserva el campo. */
  criteria: unknown;
  active: boolean;
  createdAt: string;
  schemaVersion: number;
}

export const ChallengeDefinitionSchema: z.ZodType<ChallengeDefinition> = z.object({
  id: idSchema,
  scope: ChallengeScopeSchema,
  titleKey: z.string().min(1),
  descriptionKey: z.string().min(1),
  version: z.string().min(1),
  criteria: z.unknown(),
  active: z.boolean(),
  createdAt: isoTimestampSchema,
  schemaVersion: schemaVersionSchema,
});

/**
 * ChallengeCriteria — B2-motor-de-dominio.md §4.1.
 *
 * B2 owns the shape of `ChallengeDefinition.criteria` (B3 left it as
 * `unknown`). `requiredTier` excludes "emerging" — that tier is never a
 * challenge (bar too low). `minDistinctSessions` and
 * `minDistinctCalendarDays` are the novelty/anti-farming test (§4.3):
 * an Achievement requires evidence from multiple study sessions AND
 * multiple calendar days, not a single session cram.
 */
export interface ChallengeCriteria {
  requiredTier: Exclude<MasteryTier, "emerging">;
  minDistinctSessions: number;
  minDistinctCalendarDays: number;
}

export const ChallengeCriteriaSchema: z.ZodType<ChallengeCriteria> = z.object({
  requiredTier: z.enum(["developing", "consolidated", "mastered"] as const),
  minDistinctSessions: z.number().int().min(1),
  minDistinctCalendarDays: z.number().int().min(1),
});

export const ACHIEVEMENT_STATUSES = ["earned", "revoked"] as const;
export type AchievementStatus = (typeof ACHIEVEMENT_STATUSES)[number];

export interface Achievement {
  id: string;
  userId: string;
  challengeDefinitionId: string;
  /** Snapshot al momento de ganarlo (inmutabilidad estilo O-9). */
  challengeDefinitionVersion: string;
  subjectId: string;
  topicKey: string | null;
  earnedAt: string;
  status: AchievementStatus;
  revokedAt: string | null;
  /** Founder/B2 log — nunca verbatim al estudiante, mismo tratamiento que los campos `rationale`. */
  revokedReason: string | null;
  /** Rastro auditable — qué Assessments justificaron este Achievement. */
  evidenceAssessmentIds: string[];
  /**
   * FK Achievement.id. O-5 "reintentar challenge": un reintento exitoso
   * apunta hacia atrás a la fila que corrige/reemplaza — invariante I-11:
   * NUNCA se reescribe la fila anterior.
   */
  retryOf: string | null;
  schemaVersion: number;
}

export const AchievementSchema: z.ZodType<Achievement> = z.object({
  id: idSchema,
  userId: idSchema,
  challengeDefinitionId: idSchema,
  challengeDefinitionVersion: z.string().min(1),
  subjectId: idSchema,
  topicKey: z.string().min(1).nullable(),
  earnedAt: isoTimestampSchema,
  status: z.enum(ACHIEVEMENT_STATUSES),
  revokedAt: isoTimestampSchema.nullable(),
  revokedReason: z.string().nullable(),
  evidenceAssessmentIds: z.array(idSchema),
  retryOf: idSchema.nullable(),
  schemaVersion: schemaVersionSchema,
});

export const STREAK_KINDS = ["assessment_approved"] as const;
/** Unión de un solo literal, dejada abierta a un futuro segundo kind sin renombrar la entidad. */
export type StreakKind = (typeof STREAK_KINDS)[number];

/** O-7: las rachas son de assessments aprobados, nunca de días con la app abierta. */
export interface Streak {
  id: string;
  userId: string;
  kind: StreakKind;
  current: number;
  longest: number;
  lastQualifyingAssessmentId: string | null;
  lastQualifyingAt: string | null;
  updatedAt: string;
  schemaVersion: number;
}

export const StreakSchema: z.ZodType<Streak> = z.object({
  id: idSchema,
  userId: idSchema,
  kind: z.enum(STREAK_KINDS),
  current: z.number().int().min(0),
  longest: z.number().int().min(0),
  lastQualifyingAssessmentId: idSchema.nullable(),
  lastQualifyingAt: isoTimestampSchema.nullable(),
  updatedAt: isoTimestampSchema,
  schemaVersion: schemaVersionSchema,
});
