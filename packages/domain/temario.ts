/**
 * Temario / Tema / Hito — product model (P0).
 *
 * A `Temario` is the ordered navigation structure of a `Subject`: a list of
 * `Tema` (topics the student can study freely) plus interleaved `Hito`
 * milestones (partial/final exams that review the cumulative material without
 * gating progress).
 *
 * All factories are pure. Serialization round-trips through zod schemas in
 * the same style as `@buxo/core/session`.
 */
import { z } from "zod";
import { sanitizeSubject } from "@buxo/core/subject";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";
import type { MasteryVisibility } from "./mastery";

export const TEMA_STATUSES = ["new", "studying", "done"] as const;
export type TemaStatus = (typeof TEMA_STATUSES)[number];

export const HITO_KINDS = ["parcial", "examen_final"] as const;
export type HitoKind = (typeof HITO_KINDS)[number];

export const HITO_STATUSES = ["available", "done"] as const;
export type HitoStatus = (typeof HITO_STATUSES)[number];

export const TEMARIO_GENERATED_BY = ["manual", "ai", "ai-edited"] as const;
export type TemarioGeneratedBy = (typeof TEMARIO_GENERATED_BY)[number];

export type StarCount = 0 | 1 | 2 | 3;

export interface Tema {
  id: string;
  temarioId: string;
  /** Position in the ordered topic list (0-based). */
  order: number;
  /** Sanitized title (R6). */
  title: string;
  status: TemaStatus;
  /** 0–3 star mastery grade set only by the assessor flow. */
  stars: StarCount;
  /** The single topic recommended next for this subject. */
  recommended: boolean;
  /** Syllabus unit/chapter label from a seed catalog, for grouping in the UI. NULL for own subjects (C1-b). */
  unitLabel: string | null;
  schemaVersion: number;
}

export const TemaSchema: z.ZodType<Tema> = z.object({
  id: idSchema,
  temarioId: idSchema,
  order: z.number().int().min(0),
  title: z.string().min(1),
  status: z.enum(TEMA_STATUSES),
  stars: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  recommended: z.boolean(),
  unitLabel: z.string().nullable(),
  schemaVersion: schemaVersionSchema,
});

export interface Hito {
  id: string;
  temarioId: string;
  /** Position in the ordered list (interleaved with topics). */
  order: number;
  kind: HitoKind;
  title: string;
  /** Index of the last topic included in the cumulative review scope. */
  coversUpToOrder: number;
  status: HitoStatus;
  schemaVersion: number;
}

export const HitoSchema: z.ZodType<Hito> = z.object({
  id: idSchema,
  temarioId: idSchema,
  order: z.number().int().min(0),
  kind: z.enum(HITO_KINDS),
  title: z.string().min(1),
  coversUpToOrder: z.number().int().min(0),
  status: z.enum(HITO_STATUSES),
  schemaVersion: schemaVersionSchema,
});

export interface Temario {
  id: string;
  subjectId: string;
  userId: string;
  topics: Tema[];
  milestones: Hito[];
  generatedBy: TemarioGeneratedBy;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

export const TemarioSchema: z.ZodType<Temario> = z.object({
  id: idSchema,
  subjectId: idSchema,
  userId: idSchema,
  topics: z.array(TemaSchema),
  milestones: z.array(HitoSchema),
  generatedBy: z.enum(TEMARIO_GENERATED_BY),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  schemaVersion: schemaVersionSchema,
});

// ---------------------------------------------------------------------------
// ID generation — stable, sortable, filename-safe (same style as session.ts)
// ---------------------------------------------------------------------------

function compactIso(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\./g, "");
}

function randomSuffix(length: number): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, length);
}

export function newTemarioId(now: Date = new Date()): string {
  return `${compactIso(now)}-${randomSuffix(8)}`;
}

export function newTopicId(now: Date = new Date()): string {
  return `${compactIso(now)}-t${randomSuffix(6)}`;
}

export function newMilestoneId(now: Date = new Date()): string {
  return `${compactIso(now)}-m${randomSuffix(6)}`;
}

// ---------------------------------------------------------------------------
// Pure factories
// ---------------------------------------------------------------------------

export function emptyTemario(input: {
  id?: string;
  subjectId: string;
  userId: string;
  generatedBy?: TemarioGeneratedBy;
  now?: Date;
}): Temario {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  return {
    id: input.id ?? newTemarioId(now),
    subjectId: input.subjectId,
    userId: input.userId,
    topics: [],
    milestones: [],
    generatedBy: input.generatedBy ?? "manual",
    createdAt: timestamp,
    updatedAt: timestamp,
    schemaVersion: 1,
  };
}

export function createTopic(input: {
  id?: string;
  temarioId: string;
  order: number;
  title: string;
  unitLabel?: string | null;
}): Tema {
  return {
    id: input.id ?? newTopicId(),
    temarioId: input.temarioId,
    order: input.order,
    title: sanitizeSubject(input.title),
    status: "new",
    stars: 0,
    recommended: false,
    unitLabel: input.unitLabel ?? null,
    schemaVersion: 1,
  };
}

export function createMilestone(input: {
  id?: string;
  temarioId: string;
  order: number;
  kind: HitoKind;
  title: string;
  coversUpToOrder: number;
}): Hito {
  return {
    id: input.id ?? newMilestoneId(),
    temarioId: input.temarioId,
    order: input.order,
    kind: input.kind,
    title: sanitizeSubject(input.title),
    coversUpToOrder: input.coversUpToOrder,
    status: "available",
    schemaVersion: 1,
  };
}

// ---------------------------------------------------------------------------
// Visibility projection (P4 antifuga) — `Tema.stars` is denormalized onto
// the topic row itself (unlike XP/MasteryState, which already have their own
// shadow/visible gate at the route level). Without an explicit gate HERE,
// any route that serializes a `Temario`/`Tema[]` would leak star data the
// moment the assessor flow starts writing it, regardless of
// `MASTERY_VISIBILITY_MODE`. This mirrors `projectMasteryVisibility`
// (mastery.ts) but zeroes `stars` (Tema.stars is NON-optional, 0|1|2|3 —
// it can't be omitted like MasteryClientPayload's optional field) instead of
// deleting the key, which keeps the projected value schema-valid.
// ---------------------------------------------------------------------------

/** Zero out every topic's `stars` when `visibility === "shadow"`; pass through unchanged in `visible`. Pure, no IO. */
export function projectTemasVisibility(topics: readonly Tema[], visibility: MasteryVisibility): Tema[] {
  if (visibility === "shadow") return topics.map((topic) => ({ ...topic, stars: 0 }));
  return topics.map((topic) => ({ ...topic }));
}

/** Same gate applied to a whole `Temario`'s `topics` — milestones carry no mastery data, so they pass through untouched. */
export function projectTemarioVisibility(temario: Temario, visibility: MasteryVisibility): Temario {
  return { ...temario, topics: projectTemasVisibility(temario.topics, visibility) };
}

// ---------------------------------------------------------------------------
// P5 — milestone review scope (DF-P05: "cubre TODO el cúmulo... con énfasis
// en los posteriores al hito anterior"). Pure so the milestone prompt
// (@buxo/core/milestone-prompt) and its route caller can both be unit-tested
// without a DB — this function only reads `Temario.topics`/`.milestones`.
// ---------------------------------------------------------------------------

export interface MilestoneScopeTopic {
  title: string;
  order: number;
  /** True for topics strictly after the PREVIOUS milestone's `coversUpToOrder` (or every covered topic, if this is the first milestone) — DF-P05's "énfasis en los posteriores al hito anterior". */
  emphasis: boolean;
}

/**
 * The cumulative review scope for `hito`: every topic up to and including
 * `hito.coversUpToOrder`, ordered ascending, each flagged `emphasis` if it
 * falls after the closest PRIOR milestone (by `order`, not `coversUpToOrder`
 * — a temario's milestones are interleaved with topics in `order` sequence)
 * in this same temario. A milestone with no prior sibling emphasizes its
 * entire scope (nothing to contrast against yet).
 */
export function computeMilestoneScope(temario: Pick<Temario, "topics" | "milestones">, hitoId: string): MilestoneScopeTopic[] {
  const hito = temario.milestones.find((m) => m.id === hitoId);
  if (!hito) return [];

  const priorMilestones = temario.milestones.filter((m) => m.order < hito.order);
  const previousCoversUpToOrder = priorMilestones.length > 0 ? Math.max(...priorMilestones.map((m) => m.coversUpToOrder)) : -1;

  return temario.topics
    .filter((topic) => topic.order <= hito.coversUpToOrder)
    .sort((a, b) => a.order - b.order)
    .map((topic) => ({ title: topic.title, order: topic.order, emphasis: topic.order > previousCoversUpToOrder }));
}

// ---------------------------------------------------------------------------
// Serialization round-trip
// ---------------------------------------------------------------------------

export function serializeTemario(temario: Temario): string {
  return JSON.stringify(temario, null, 2);
}

export function parseTemario(value: unknown): Temario {
  return TemarioSchema.parse(value);
}

export function deserializeTemario(json: string): Temario {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Temario JSON is not valid");
  }
  return parseTemario(parsed);
}

export function serializeTopic(topic: Tema): string {
  return JSON.stringify(topic, null, 2);
}

export function parseTopic(value: unknown): Tema {
  return TemaSchema.parse(value);
}

export function serializeMilestone(milestone: Hito): string {
  return JSON.stringify(milestone, null, 2);
}

export function parseMilestone(value: unknown): Hito {
  return HitoSchema.parse(value);
}
