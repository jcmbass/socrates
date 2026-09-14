/**
 * StudySession — B3-modelo-de-dominio.md §2.7. Evolution of the alfa's
 * `Session` (`@buxo/core/session`).
 *
 * `Band` is reused as-is from `@buxo/core/prompts` (B3 §1: "no se redefine
 * aquí, solo se referencia"). `BandChange` here is a NEW value object (B3
 * §1: embedded in `StudySession`, no own schemaVersion) — same field names
 * as `@buxo/core/session`'s `BandChange`, but `rationale` is required
 * (`string | null`) here instead of optional, and its docblock is
 * `@sensitive-adjacent` per B3 §6.1 (it can paraphrase student reasoning).
 *
 * `Session.messages` (the alfa, `@buxo/core/session`'s `StoredMessage[]`)
 * does NOT survive as a field here (B3 §0.2, §2.7 note): it's reconstructed
 * from `Exchange.studentMessage`/`tutorReply` in `index` order.
 */
import { z } from "zod";
import type { Band } from "@buxo/core/prompts";
import { BANDS } from "@buxo/core/prompts";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

export const STUDY_SESSION_STATUSES = ["active", "completed", "abandoned"] as const;
export type StudySessionStatus = (typeof STUDY_SESSION_STATUSES)[number];

/**
 * P5 (DF-P12/DF-P05) — what a session is FOR, which decides both which
 * adapter/prompt serves it (`routes/sessions.ts`: "topic" → `tutorAdapter`
 * + `buxo-socratic-*`, "milestone" → `milestoneAdapter` +
 * `buxo-milestone-v1`, a NEW/separate prompt, R2: never the tutor's) and
 * which context it gets (a "topic" session's tutor leans on the subject's
 * Fuentes + its own `topicId`; a "milestone" session's leans on the
 * subject's Fuentes + the cumulative topic scope up to `Hito.coversUpToOrder`,
 * `@buxo/domain/temario`'s `computeMilestoneScope`). Default `"topic"` keeps
 * every pre-P5 session (and every session with no `topicId`, the legacy
 * subject-level chat `app/study/[subjectId].tsx` still opens) reading back
 * unchanged.
 */
export const STUDY_SESSION_KINDS = ["topic", "milestone"] as const;
export type StudySessionKind = (typeof STUDY_SESSION_KINDS)[number];

export const BAND_CHANGE_SOURCES = ["auto", "manual", "initial"] as const;
export type BandChangeSource = (typeof BAND_CHANGE_SOURCES)[number];

export interface BandChange {
  band: Band;
  timestamp: string;
  source: BandChangeSource;
  /**
   * Founder/logs únicamente — nunca al estudiante. Puede parafrasear
   * razonamiento del estudiante: tratamiento @sensitive-adjacent (B3 §6.1).
   */
  rationale: string | null;
}

export const BandChangeSchema: z.ZodType<BandChange> = z.object({
  band: z.enum(BANDS),
  timestamp: isoTimestampSchema,
  source: z.enum(BAND_CHANGE_SOURCES),
  rationale: z.string().nullable(),
});

export interface MaterialSnapshotInfo {
  truncated: boolean;
  droppedTokens: number;
}

export const MaterialSnapshotInfoSchema: z.ZodType<MaterialSnapshotInfo> = z.object({
  truncated: z.boolean(),
  droppedTokens: z.number().int().min(0),
});

export const MATERIAL_EVENT_KINDS = ["paste", "txt", "pdf"] as const;
export type MaterialEventKind = (typeof MATERIAL_EVENT_KINDS)[number];

export const MATERIAL_EVENT_ACTIONS = ["added", "removed"] as const;
export type MaterialEventAction = (typeof MATERIAL_EVENT_ACTIONS)[number];

/**
 * MaterialEvent — F2 WQ2/WQ3 mandate (reassigned WQ2→WQ3): closes the
 * WQ2 acceptance-6 gap (`docs/plan-app-multiplataforma/reports/
 * wq2-reporte.md` §4.3, `apps/mobile/components/MaterialIngestBar.tsx`'s
 * former "DEVIATION" note). This EXTENDS B3-modelo-de-dominio.md §2.9
 * beyond what that spec modeled: B3 mapped the alfa's `materialEvents`
 * log onto `MaterialAsset` + `StudySession.materialAssetIds` (an entity +
 * an id-list — B3 §0.2 explicitly dropped the chronological log), which
 * lost the "when did a guide get added, inline in the transcript" trail
 * the harness v2 (`@buxo/core/session`'s `Session.materialEvents`) has.
 * This value object adds that trail back for the server-authoritative
 * session, WITHOUT reverting the B3 §2.9 entity mapping — `materialAssetId`
 * below is a NEW field vs. the harness shape (`@buxo/core/transcript`'s
 * `MaterialEvent`), pointing at the real `MaterialAsset` row that produced
 * this event. `kind`/`action` keep the harness's exact vocabulary
 * (paridad) — see `apps/server/src/materials/events.ts` for how a
 * `MaterialAsset.kind` maps onto it.
 */
export interface MaterialEvent {
  timestamp: string;
  /** FK MaterialAsset.id — NEW vs. the harness's MaterialEvent (which has no persisted entity to point at). */
  materialAssetId: string;
  /** Display name — the MaterialAsset's original filename, or a fixed label for pasted text (no filename to show). */
  source: string;
  kind: MaterialEventKind;
  /** "removed" is a legal value with no current producer (no server-side material-removal flow exists yet) — kept for harness-shape parity and future use. */
  action: MaterialEventAction;
}

export const MaterialEventSchema: z.ZodType<MaterialEvent> = z.object({
  timestamp: isoTimestampSchema,
  materialAssetId: idSchema,
  source: z.string().min(1),
  kind: z.enum(MATERIAL_EVENT_KINDS),
  action: z.enum(MATERIAL_EVENT_ACTIONS),
});

export interface StudySession {
  /** Formato heredado de `newSessionId()` en la alfa (ordenable por tiempo). */
  id: string;
  userId: string;
  /** FK Subject.id — REEMPLAZA el `subject: string` libre de la alfa. */
  subjectId: string;
  /** Copia inmutable de Subject.name al iniciar — display histórico correcto aunque la Subject se renombre después. */
  subjectNameSnapshot: string;
  createdAt: string;
  updatedAt: string;
  status: StudySessionStatus;

  /**
   * P5 — "topic" (default, sesión de estudio normal sobre un tema) o
   * "milestone" (ronda de repaso de un Hito, DF-P05). Ver el docblock de
   * `STUDY_SESSION_KINDS` arriba.
   */
  kind: StudySessionKind;
  /** P5 (DF-P12) — FK Tema.id cuando `kind === "topic"` y la sesión se abrió sobre un tema puntual; `null` en sesiones legado sin tema (subject-level) y SIEMPRE `null` cuando `kind === "milestone"`. */
  topicId: string | null;
  /** P5 (DF-P05) — FK Hito.id cuando `kind === "milestone"`; `null` en toda sesión `"topic"`. */
  milestoneId: string | null;

  /**
   * Plan-xp-progreso Fase 3.3/4 — when a closed session is reactivated by
   * opening a NEW session on the same topic, this points at the prior
   * session. Null for first-ever sessions. Continuity without merging
   * histories (each session stays a clean analysis unit).
   */
  previousSessionId: string | null;

  initialBand: Band;
  /** Qué MaterialAsset(s) dieron grounding a esta sesión. */
  materialAssetIds: string[];
  /**
   * Puntero inmutable (direccionado por contenido) al texto digerido EXACTO
   * usado como grounding al iniciar la sesión — reproducibilidad aunque el
   * MaterialAsset subyacente se edite/reemplace después.
   */
  materialSnapshotTextRef: string | null;
  /** lib/transcript.ts's MaterialInfo, promovido. */
  materialSnapshotInfo: MaterialSnapshotInfo | null;

  /** Value object embebido — nada externo referencia un BandChange individual por id. */
  bandChanges: BandChange[];

  /**
   * Value object embebido, append-only — rastro cronológico de attaches de
   * material (F2 WQ2/WQ3, ver docblock de `MaterialEvent` arriba). Siempre
   * en orden de inserción == orden cronológico ascendente: cada punto de
   * attach (creación de sesión, `POST /:id/materials`) solo hace push al
   * final, nunca reordena ni edita entradas previas.
   */
  materialEvents: MaterialEvent[];

  schemaVersion: number;
}

export const StudySessionSchema: z.ZodType<StudySession> = z.object({
  id: idSchema,
  userId: idSchema,
  subjectId: idSchema,
  subjectNameSnapshot: z.string().min(1),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  status: z.enum(STUDY_SESSION_STATUSES),

  kind: z.enum(STUDY_SESSION_KINDS),
  topicId: idSchema.nullable(),
  milestoneId: idSchema.nullable(),
  previousSessionId: idSchema.nullable(),

  initialBand: z.enum(BANDS),
  materialAssetIds: z.array(idSchema),
  materialSnapshotTextRef: z.string().min(1).nullable(),
  materialSnapshotInfo: MaterialSnapshotInfoSchema.nullable(),

  bandChanges: z.array(BandChangeSchema),
  materialEvents: z.array(MaterialEventSchema),

  schemaVersion: schemaVersionSchema,
});
