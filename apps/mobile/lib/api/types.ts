/**
 * apps/server /v1 response DTOs. Where the server hands back a
 * `@buxo/domain` entity VERBATIM (verified against
 * apps/server/src/repositories/*.ts: every `rowTo*` returns exactly the
 * `@buxo/domain` shape, and routes `c.json()` it directly with no
 * transform), this module re-exports that domain type instead of
 * duplicating its fields — packages/domain is already a dependency of
 * apps/mobile (lib/store.ts, lib/localStore.ts used it under WP2 too).
 * Shapes that DON'T match a domain entity 1:1 (the sessions list summary,
 * the full-session-with-exchanges envelope, auth responses) get their own
 * interface here.
 */
import type { Course } from "@buxo/domain/course";
import type { Subject } from "@buxo/domain/subject";
import type { StudySession, MaterialEvent } from "@buxo/domain/study-session";
import type { Exchange } from "@buxo/domain/exchange";
import type { SessionOpening } from "@buxo/domain/session-opening";
import type { MaterialAsset } from "@buxo/domain/material-asset";
import type { Temario, Tema, Hito } from "@buxo/domain/temario";
import type { Fuente, FuenteKind } from "@buxo/domain/fuente";

export type { Course, Subject, StudySession, Exchange, MaterialAsset, MaterialEvent, Temario, Tema, Hito, Fuente, FuenteKind, SessionOpening };

/** POST /v1/auth/signup body — C-backend §2.4, DF-6.2 magic-link signup payload. */
export interface SignupInput {
  email: string;
  displayName: string;
  ageConfirmedAt: string;
  consents: Array<{ type: "terms_13plus" | "privacy_policy"; policyVersion: string }>;
}

/**
 * POST /v1/auth/verify response. email/displayName come from the server's
 * own record (apps/server/src/routes/auth.ts), never guessed client-side —
 * cold-start via a deep link has no local form state to fall back on.
 */
export interface VerifyResult {
  userId: string;
  token: string;
  email: string;
  displayName: string;
}

/** Persisted locally (lib/localStore.ts) so the app resumes logged-in across restarts (C3/O-8: the server is the source of truth for everything else). */
export interface AuthSession {
  userId: string;
  email: string;
  displayName: string;
  token: string;
}

export interface CreateCourseInput {
  gradeLevelId: string;
  academicYear?: number;
}

export interface CreateSubjectInput {
  courseId: string;
  name: string;
}

/** GET /v1/sessions?status=active row shape — routes/sessions.ts's GET "/" handler, NOT the full StudySession. */
export interface ActiveSessionSummary {
  id: string;
  subjectId: string;
  subjectNameSnapshot: string;
  /** P5 — "topic" (default) or "milestone" (DF-P05 review round). */
  kind: "topic" | "milestone";
  /** P5 (DF-P12) — non-null only on a "topic" session opened on a specific tema. */
  topicId: string | null;
  /** P5 (DF-P05) — non-null only on a "milestone" session. */
  milestoneId: string | null;
  createdAt: string;
  updatedAt: string;
  exchangeCount: number;
}

/** GET /v1/sessions/:id response — the full StudySession plus its Exchange history (C3 "sesiones retomables") and optional tutor opening. */
export interface FullStudySession extends StudySession {
  exchanges: Exchange[];
  opening?: SessionOpening | null;
}

export interface CreateSessionInput {
  subjectId: string;
  /** P5 (DF-P12) — opens the chat scoped to one topic. Mutually exclusive with milestoneId. */
  topicId?: string;
  /** P5 (DF-P05) — opens a milestone review round instead of a normal topic session. Mutually exclusive with topicId. */
  milestoneId?: string;
}

/** POST /v1/fuentes/:subjectId body — P5, the client-side counterpart of the server's already-existing (P1) Fuente CRUD (`apps/server/src/routes/fuentes.ts`). Text-only by construction (DF-P10): there is no binary/file field here to begin with — the PDF/foto is ingested client-side (the SAME Tier-0 pdf.js + Tier-2 server pipeline `MaterialIngestBar`/`materialIngestBridge.ts` already use) and only its EXTRACTED TEXT ever reaches this call. */
export interface CreateFuenteInput {
  name: string;
  kind: FuenteKind;
  text: string;
  tokens?: number;
}

/** GET /v1/streak — R-4: racha actual del estudiante. */
export interface StreakResult {
  current: number;
  longest: number;
  reasonKeys: string[];
}

/** GET /v1/activity — A-producto-ux §5.2: señales honestas de actividad (sombra en F3). */
export interface ActivityResult {
  recentSessionCount: number;
  totalExchangeCount: number;
  streak: { current: number; longest: number };
}

/**
 * GET /v1/xp[/:subjectId] — P4. `visible`/`raw`/`events` are OMITTED by the
 * server (not `null`/`0`) while `MASTERY_VISIBILITY_MODE=shadow`
 * (`routes/xp.ts`'s antifuga helper) — every field here is therefore
 * optional, and callers must treat "absent" as "don't show a number",
 * never crash on it (see `lib/homeCards.ts`'s `deriveXpDisplay`).
 * Plan-xp-progreso Fase 2: `visibility` is ALWAYS present so the client
 * can distinguish shadow from "visible but zero".
 */
export interface XpSummary {
  raw?: number;
  visible?: number;
  policy: "subtract" | "floor" | "grow_only";
  subjectId: string | null;
  events?: unknown[];
  visibility: "shadow" | "visible";
}

/**
 * GET /v1/temario/:subjectId — domain Temario plus the visibility signal.
 * C2-d: also carries the subject's seed provenance, colgado de esta MISMA
 * respuesta (the only one `temario.tsx` fetches) instead of a new endpoint —
 * `seedCatalogKey` (e.g. "universidad/fisica", `null` for a student's own
 * subject) lets the client derive the header's nivel caption
 * (`seedCatalogKey.split("/")[0]`), and `seedAttribution` is the CC BY line
 * for the footer, already resolved server-side for the subject's frozen
 * `seedLang` (`@buxo/domain/seed-catalog`'s `seedAttributionFor`) — `null`
 * for a non-seed subject.
 *
 * C2-e: `seedMaterialLang` (`seedSourceLangFor`, same internal resolver) is
 * the language of the BOOK behind the temario, which can diverge from the
 * UI language — `Subject.seedLang` is frozen from
 * `users.preferredLanguageCode` without looking at the catalog's sources
 * (C2-a), so an `es` user with `bachillerato/fisica` (its only source is
 * OpenStax's EN "Physics") studies a Spanish temario backed by an English
 * book; the home card uses this for the discreet "Material en inglés" note.
 * `null` for a non-seed subject.
 */
export type TemarioWithVisibility = Temario & {
  visibility: "shadow" | "visible";
  seedCatalogKey: string | null;
  seedAttribution: SeedAttribution | null;
  seedMaterialLang: "es" | "en" | null;
};

/**
 * GET /v1/seed/subjects?level=… response row (C2-a). Deliberately NOT
 * imported from `@buxo/domain/seed-catalog`'s `SeedSubjectSummary` —
 * that module's docblock forbids `apps/mobile` from depending on
 * `@buxo/domain/data/seed` (~1.1 MB of JSON that would bloat the bundle
 * for data the client never needs in full). This is a hand-typed mirror of
 * the server's response DTO instead.
 */
export interface SeedSubjectOption {
  level: "bachillerato" | "universidad";
  subjectKey: string;
  name: { es: string; en: string };
  unitCount: { es: number; en: number };
  topicCount: { es: number; en: number };
}

/** GET /v1/seed/attributions response row — one per unique seed book (C2-a, ADENDA §(b)). */
export interface SeedAttribution {
  title: string;
  publisher: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
}

/** GET /v1/me response (D-C07). */
export interface MeResult {
  onboardingCompletedAt: string | null;
}

/** Guided session item — server strips `answer` until after submit (D1-b). */
export interface GuidedItemPublic {
  id: string;
  type: "elige" | "verdadero_falso" | "completa" | "expose";
  difficulty: 1 | 2 | 3;
  prompt: string;
  options: string[];
  explanation: string;
}

/** POST ensure / GET items response. */
export interface TopicItemsResult {
  items: GuidedItemPublic[];
  degraded: boolean;
  degradedReason: "generation_failed" | "sources_required" | null;
  grounding: "sources" | "general";
  generatorVersion: string;
}

/** POST .../items/:itemId/answer response. */
export interface GuidedAnswerResult {
  correct: boolean;
  explanation: string;
  xpDelta: number;
}

/** POST .../guided:complete response. */
export interface GuidedCompleteResult {
  xpDelta: number;
}
