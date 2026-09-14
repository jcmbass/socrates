/**
 * MasteryState / MasteryHistoryEntry — B3-modelo-de-dominio.md §2.10.
 *
 * `MasteryLevel` was a deliberate opaque placeholder in B3 (§0 point 9, §8
 * R-7: "B3 se negó a adivinar la escala real de dominio porque es
 * semántica de B2, no forma"). B2 (`B2-motor-de-dominio.md` §2) has since
 * filled it with a composite structure — confirmed by the architect's
 * cross-validation (`02-validacion-arquitecto.md`, "B3↔B2": "`MasteryLevel`
 * placeholder llenado por B2 (tier compuesto, 4 niveles)"). `MasteryTier`/
 * `MasteryEvidenceRef`/`MasteryLevel` below are B2's shape, reproduced here
 * verbatim (not a domain re-derivation) because B3 is the shared source of
 * truth this package implements and the placeholder is no longer open.
 * Comparability (B3's "¿subió o bajó?" requirement) is defined ONLY over
 * `tier`, via the fixed order emerging(0) < developing(1) < consolidated(2)
 * < mastered(3) — see `compareMasteryTier` below and B2 §2.
 */
import { z } from "zod";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

export const MASTERY_VISIBILITIES = ["shadow", "visible"] as const;
/** O-5: shadow durante TODA la beta. */
export type MasteryVisibility = (typeof MASTERY_VISIBILITIES)[number];

export const MasteryVisibilitySchema = z.enum(MASTERY_VISIBILITIES);

// ---------------------------------------------------------------------------
// MasteryLevel (B2 §2 — fills B3's placeholder)
// ---------------------------------------------------------------------------

export const MASTERY_TIERS = ["emerging", "developing", "consolidated", "mastered"] as const;
export type MasteryTier = (typeof MASTERY_TIERS)[number];

/** Fixed comparison order (B2 §2): emerging(0) < developing(1) < consolidated(2) < mastered(3). */
export const MASTERY_TIER_ORDER: Record<MasteryTier, number> = {
  emerging: 0,
  developing: 1,
  consolidated: 2,
  mastered: 3,
};

/** -1 if a < b, 0 if equal, 1 if a > b — comparison is over `tier` only (B2 §2). */
export function compareMasteryTier(a: MasteryTier, b: MasteryTier): -1 | 0 | 1 {
  const diff = MASTERY_TIER_ORDER[a] - MASTERY_TIER_ORDER[b];
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

/** Projection of mastery tier to visible stars (0–3). Defined in domain, not UI (F4). */
export type StarCount = 0 | 1 | 2 | 3;

const TIER_TO_STARS: Record<MasteryTier, StarCount> = {
  emerging: 0,
  developing: 1,
  consolidated: 2,
  mastered: 3,
};

/** Map a `MasteryTier` to the 0–3 star count shown to the student. */
export function tierToStars(tier: MasteryTier): StarCount {
  return TIER_TO_STARS[tier];
}

/** Client-visible subset of mastery data. Stars and XP are suppressed while in `shadow`. */
export interface MasteryClientPayload {
  tier: MasteryTier;
  stars: StarCount;
  xp?: number;
  historyEntryId?: string;
}

/**
 * Antileak seam: strip `stars` and `xp` from a mastery payload when visibility is
 * `shadow`. In `visible` mode the payload is returned unchanged (shallow copy).
 * Pure; testable without IO.
 */
export function projectMasteryVisibility<T extends { stars?: StarCount; xp?: number }>(
  payload: T,
  visibility: MasteryVisibility,
): T | Omit<T, "stars" | "xp"> {
  if (visibility === "shadow") {
    const rest = { ...payload };
    if ("stars" in rest) delete rest.stars;
    if ("xp" in rest) delete rest.xp;
    return rest as Omit<T, "stars" | "xp">;
  }
  return { ...payload };
}

/** Seed of Achievement.evidenceAssessmentIds and of "por qué subió" (A5). */
export interface MasteryEvidenceRef {
  assessmentId: string;
  sessionId: string;
  timestamp: string;
}

export const MasteryEvidenceRefSchema: z.ZodType<MasteryEvidenceRef> = z.object({
  assessmentId: idSchema,
  sessionId: idSchema,
  timestamp: isoTimestampSchema,
});

/**
 * Composite structure (B2 §2, answers B3 R-7: "no, un escalar simple no
 * alcanza"). `computedByVersion` identifies THIS structure + the reducer
 * that produced it as one versioned unit (lives on `MasteryHistoryEntry`,
 * not here — B3 §3).
 */
export interface MasteryLevel {
  tier: MasteryTier;
  /** Rachas consecutivas del reductor B2 §1.3 — auditoría de promoción/democión. */
  positiveStreak: number;
  negativeStreak: number;
  /** Evidencia strongPositive acumulada hacia la PRÓXIMA promoción (reset en cada promoción/democión). */
  strongCount: number;
  /** Hasta 6 referencias más recientes que alimentan strongCount. */
  recentStrongEvidence: MasteryEvidenceRef[];
  lastPositiveAt: string | null;
  /** Timestamp de la última promoción — exigencia de separación de ≥3 días entre consolidated→mastered (B2 §1.3). */
  lastPromotionAt: string | null;
}

export const MasteryLevelSchema: z.ZodType<MasteryLevel> = z.object({
  tier: z.enum(MASTERY_TIERS),
  positiveStreak: z.number().int().min(0),
  negativeStreak: z.number().int().min(0),
  strongCount: z.number().int().min(0),
  recentStrongEvidence: z.array(MasteryEvidenceRefSchema).max(6),
  lastPositiveAt: isoTimestampSchema.nullable(),
  lastPromotionAt: isoTimestampSchema.nullable(),
});

// ---------------------------------------------------------------------------
// MasteryState / MasteryHistoryEntry
// ---------------------------------------------------------------------------

/**
 * Puntero actual/último — UNA fila por (userId, subjectId, topicKey).
 * Invariante I-2: nunca se edita a mano; solo el job de agregación de B2 la
 * escribe, siempre junto con la MasteryHistoryEntry correspondiente.
 */
export interface MasteryState {
  id: string;
  userId: string;
  subjectId: string;
  /** "" reservado como sentinela de rollup a nivel de materia (SUBJECT_ROLLUP_TOPIC_KEY, sentinels.ts) — invariante I-9. */
  topicKey: string;
  /**
   * Optional UUID of the `Tema` in the subject's `Temario`. `null`/`undefined` means
   * subject-level rollup (same semantic as `topicKey === ""`). Added in P0; kept
   * optional so existing subject-level records stay byte-identical when absent.
   */
  topicId?: string | null;
  currentLevel: MasteryLevel;
  visibility: MasteryVisibility;
  /** FK MasteryHistoryEntry.id */
  lastHistoryEntryId: string;
  updatedAt: string;
  schemaVersion: number;
}

export const MasteryStateSchema: z.ZodType<MasteryState> = z.object({
  id: idSchema,
  userId: idSchema,
  subjectId: idSchema,
  topicKey: z.string(),
  topicId: z.string().min(1).nullable().optional(),
  currentLevel: MasteryLevelSchema,
  visibility: MasteryVisibilitySchema,
  lastHistoryEntryId: idSchema,
  updatedAt: isoTimestampSchema,
  schemaVersion: schemaVersionSchema,
});

/**
 * Append-only, inmutable una vez escrita (invariante I-3) — el rastro
 * auditable que pide O-5, y la base de A5 ("el estudiante entiende POR QUÉ
 * subió").
 */
export interface MasteryHistoryEntry {
  id: string;
  userId: string;
  subjectId: string;
  topicKey: string;
  /** Optional UUID of the `Tema` this entry refers to; `null`/`undefined` = subject rollup. */
  topicId?: string | null;
  level: MasteryLevel;
  computedAt: string;
  /**
   * Versión del ALGORITMO de agregación de B2 (no de un modelo de IA) —
   * disciplina O-9 extendida al agregador mismo. `"b2-agg-1"` para la
   * primera versión (B2 §2).
   */
  computedByVersion: string;
  /** Rastro auditable — qué Assessments alimentaron este cálculo. */
  contributingAssessmentIds: string[];
  schemaVersion: number;
}

export const MasteryHistoryEntrySchema: z.ZodType<MasteryHistoryEntry> = z.object({
  id: idSchema,
  userId: idSchema,
  subjectId: idSchema,
  topicKey: z.string(),
  topicId: z.string().min(1).nullable().optional(),
  level: MasteryLevelSchema,
  computedAt: isoTimestampSchema,
  computedByVersion: z.string().min(1),
  contributingAssessmentIds: z.array(idSchema),
  schemaVersion: schemaVersionSchema,
});
