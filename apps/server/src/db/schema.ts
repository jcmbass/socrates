/**
 * Drizzle/Postgres schema — WP5 (C2), mapping the B3 domain shapes
 * (`@buxo/domain`) onto relational tables per C-backend-plataforma.md §2.3:
 * `Exchange`/`Assessment`/`StudySession` etc. as first-class tables with FKs
 * (confirms R-1 — Postgres joins are cheap at beta scale); embedded value
 * objects (`BandChange[]`, `MaterialProcessingEntry[]`, `MaterialStorageRef`)
 * as `jsonb` columns on their owning entity's row, exactly as B3 §1
 * distinguishes "entity" from "value object".
 *
 * DEVIATIONS from a literal 1:1 domain-shape mapping (documented, all scoped
 * to what F1/WP5 actually needs):
 *
 * 1. Timestamps are `text` (ISO-8601 strings), not Postgres `timestamptz`.
 *    `@buxo/domain`'s `isoTimestampSchema` is `z.iso.datetime()` — a
 *    `text` column keeps every row byte-parseable by that exact schema with
 *    zero driver-side conversion, and ISO-8601 strings remain lexicographically
 *    ordorable (same convention `@buxo/core/session`'s docblock already
 *    states the alfa relies on). A `timestamptz` column would be more
 *    idiomatic Postgres but reopens exactly the kind of round-trip drift
 *    C-backend-plataforma.md's C7 section spends a whole section warning
 *    about (never trust an implicit conversion you haven't verified).
 * 2. `User.authIdentifiers` (B3 §2.1, a value object array) gets ONE
 *    additional normalized column here, `primaryEmail` (unique, indexed) —
 *    the full `authIdentifiers` array is still stored verbatim in
 *    `authIdentifiers` (jsonb) for domain fidelity, but magic-link auth
 *    (DF-6.2) needs a fast, uniquely-indexed lookup by email that a jsonb
 *    array scan can't give cheaply. `primaryEmail` is a read-optimization
 *    derived from `authIdentifiers[0]`, not a new fact.
 * 3. `Achievement`/`MigrationRecord` still have NO tables here — gamification
 *    is explicitly F3 scope ("Qué NO entra en F1", 04-plan-f1.md). `GET
 *    /v1/achievements` stays implemented as an honest empty list
 *    (routes/achievements.ts).
 *
 *    `MasteryState`/`MasteryHistoryEntry` (B2-motor-de-dominio.md §2, F2
 *    WQ3 parte B1) DO get tables now — see `masteryStates`/
 *    `masteryHistoryEntries` below. `GET /v1/mastery/:subjectId` still
 *    always 404s (routes/mastery.ts) — B2 §5.1 shadow mode means rows now
 *    exist but are never `visible` to the student route; only
 *    `GET /v1/mastery/:subjectId/inspect` (internal_dev-only, B2 §5.2) reads
 *    them.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  unique,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

/** Embedding dimensionality for plan-modal-rag F2 (multilingual MiniLM / e5-small). */
export const FUENTE_CHUNK_EMBEDDING_DIMS = 384 as const;

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),

  displayName: text("display_name").notNull(),
  /** Full B3 AuthIdentifier[] value object array — see DEVIATION 2 above. */
  authIdentifiers: jsonb("auth_identifiers").notNull().$type<
    Array<{ type: "email" | "phone" | "external_oauth"; value: string; verifiedAt: string | null; isPrimary: boolean }>
  >(),
  /** Read-optimized denormalization of the primary email identifier — DEVIATION 2. */
  primaryEmail: text("primary_email").notNull(),

  countryCode: text("country_code").notNull(),
  preferredLanguageCode: text("preferred_language_code").notNull(),

  ageConfirmedAt: text("age_confirmed_at").notNull(),
  birthYear: integer("birth_year"),

  currentCourseId: text("current_course_id"),
  accountStatus: text("account_status").notNull().$type<"active" | "suspended" | "deleted">(),
  deletedAt: text("deleted_at"),

  accountKind: text("account_kind").notNull().$type<"student" | "internal_dev">(),

  /** D-C07: NULL means the user has not completed the seed onboarding flow yet (C1-b). */
  onboardingCompletedAt: text("onboarding_completed_at"),
}, (t) => [
  /**
   * R11 (beta cerrada, lote 3 — docs/plan-beta-real/11-observaciones-beta-cerrada.md):
   * la unicidad del correo vale SOLO entre cuentas vivas. El constraint plano
   * anterior (`users_primary_email_unique`) hacía que el tombstone de una
   * cuenta borrada (`account_status = 'deleted'`, que conserva su
   * `primary_email` a propósito, para auditoría) bloqueara para siempre el
   * re-registro con ese mismo correo. El índice parcial libera el correo sin
   * mutar una sola fila histórica.
   *
   * Su espejo en la aplicación es el filtro `accountStatus <> 'deleted'` de
   * `findUserByEmail` (repositories/users.ts): sin ese filtro el índice no
   * alcanza — `POST /v1/auth/signup` seguiría devolviendo 409 contra la fila
   * tombstoned. Los dos cambios son una sola corrección, no dos.
   */
  uniqueIndex("users_primary_email_active_uidx")
    .on(t.primaryEmail)
    .where(sql`${t.accountStatus} <> 'deleted'`),
]);

export const consents = pgTable("consents", {
  id: text("id").primaryKey(),
  /**
   * NO db-level FK to users.id on purpose (B3 §7 I-6, C-backend §5.3 R-8):
   * on account deletion this column is REPLACED with a salted pseudonym
   * token, not cascaded/deleted — a hard FK would make that rewrite
   * awkward and is exactly the "append-only, never purged" ledger B3
   * models. Ownership is enforced at the application layer instead.
   */
  userId: text("user_id").notNull(),
  type: text("type").notNull().$type<"terms_13plus" | "privacy_policy" | "data_processing" | "parental">(),
  status: text("status").notNull().$type<"accepted" | "withdrawn">(),
  policyVersion: text("policy_version").notNull(),
  occurredAt: text("occurred_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [index("consents_user_id_idx").on(t.userId)]);

export const courses = pgTable("courses", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  gradeLevelId: text("grade_level_id").notNull(),
  customLabel: text("custom_label"),
  academicYear: integer("academic_year"),
  status: text("status").notNull().$type<"active" | "archived">(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [index("courses_user_id_idx").on(t.userId)]);

export const subjects = pgTable("subjects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  courseId: text("course_id").notNull().references(() => courses.id),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  archivedAt: text("archived_at"),
  /** Seed catalog provenance, e.g. "universidad/quimica" — NULL for a student's own subject (C1-b). */
  seedCatalogKey: text("seed_catalog_key"),
  /** Material language frozen at activation time for a seed subject, e.g. "es" | "en" (C1-b). */
  seedLang: text("seed_lang"),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [index("subjects_course_id_idx").on(t.courseId), index("subjects_user_id_idx").on(t.userId)]);

export const materialAssets = pgTable("material_assets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  kind: text("kind").notNull().$type<"pdf" | "photo" | "paste" | "txt">(),
  originalFilename: text("original_filename"),
  createdAt: text("created_at").notNull(),
  status: text("status").notNull().$type<"pending" | "digesting" | "ready" | "partial" | "failed">(),
  storage: jsonb("storage").notNull().$type<{ location: "device_only" | "cloud_blob"; blobRef: string | null }>(),
  digestedTextRef: text("digested_text_ref").notNull(),
  tokenCount: integer("token_count"),
  truncated: boolean("truncated").notNull().default(false),
  droppedTokens: integer("dropped_tokens").notNull().default(0),
  processingReport: jsonb("processing_report")
    .notNull()
    .$type<
      Array<{
        page: number | null;
        route: "local" | "cloud-figure" | "cloud-page";
        costUsd: number | null;
        cached: boolean;
        rasterMs?: number | null;
        modelMs?: number | null;
        safetyMs?: number | null;
        totalMs?: number | null;
      }>
    >(),
  digestionPipelineVersion: text("digestion_pipeline_version").notNull(),
  removedAt: text("removed_at"),
  schemaVersion: integer("schema_version").notNull().default(1),
  /**
   * Client upload idempotency key (same spirit as turn_claims.client_message_id).
   * Optional: old APKs omit it. Unique per user when present — Postgres treats
   * NULLs as distinct, so paste/photo rows without a key do not collide.
   */
  clientUploadId: text("client_upload_id"),
}, (t) => [
  index("material_assets_subject_id_idx").on(t.subjectId),
  index("material_assets_user_id_idx").on(t.userId),
  uniqueIndex("material_assets_user_client_upload_uidx").on(t.userId, t.clientUploadId),
]);

export const studySessions = pgTable("study_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  subjectNameSnapshot: text("subject_name_snapshot").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  status: text("status").notNull().$type<"active" | "completed" | "abandoned">(),
  /** P5 — "topic" (default) or "milestone" (DF-P05 review round); see @buxo/domain/study-session's STUDY_SESSION_KINDS docblock. */
  kind: text("kind").notNull().default("topic").$type<"topic" | "milestone">(),
  /** P5 (DF-P12) — FK Tema.id, no DB-level constraint (temas is declared later in this file; ownership is checked at the route layer, same discipline as materialAssetIds). Null for legacy/subject-level sessions and always null when kind==="milestone". */
  topicId: text("topic_id"),
  /** P5 (DF-P05) — FK Hito.id, same no-DB-FK reasoning as topicId above. Null unless kind==="milestone". */
  milestoneId: text("milestone_id"),
  /**
   * Plan-xp-progreso Fase 3.3 — prior closed session this one reactivates.
   * No DB-level FK (same discipline as topicId/milestoneId); ownership checked at the route layer.
   */
  previousSessionId: text("previous_session_id"),
  initialBand: text("initial_band").notNull().$type<"guiding" | "probing" | "minimal">(),
  materialAssetIds: jsonb("material_asset_ids").notNull().$type<string[]>(),
  materialSnapshotTextRef: text("material_snapshot_text_ref"),
  materialSnapshotInfo: jsonb("material_snapshot_info").$type<{ truncated: boolean; droppedTokens: number } | null>(),
  bandChanges: jsonb("band_changes")
    .notNull()
    .$type<Array<{ band: "guiding" | "probing" | "minimal"; timestamp: string; source: "auto" | "manual" | "initial"; rationale: string | null }>>(),
  /**
   * MaterialEvent[] — F2 WQ2/WQ3 reassignment (see `@buxo/domain/
   * study-session`'s `MaterialEvent` docblock). Default `[]` so every row
   * created before this column existed reads back as an empty (not null)
   * array — no backfill migration needed.
   */
  materialEvents: jsonb("material_events")
    .notNull()
    .default([])
    .$type<Array<{ timestamp: string; materialAssetId: string; source: string; kind: "paste" | "txt" | "pdf"; action: "added" | "removed" }>>(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  index("study_sessions_user_id_idx").on(t.userId),
  index("study_sessions_subject_id_idx").on(t.subjectId),
  index("study_sessions_user_status_idx").on(t.userId, t.status),
  index("study_sessions_topic_id_idx").on(t.topicId),
  index("study_sessions_milestone_id_idx").on(t.milestoneId),
]);

export const exchanges = pgTable("exchanges", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => studySessions.id),
  index_: integer("index").notNull(),
  timestamp: text("timestamp").notNull(),

  studentMessage: text("student_message").notNull(),
  tutorReply: text("tutor_reply").notNull(),
  band: text("band").notNull().$type<"guiding" | "probing" | "minimal">(),

  tutorPromptVersion: text("tutor_prompt_version").notNull(),
  tutorModelId: text("tutor_model_id").notNull(),
  tutorProviderId: text("tutor_provider_id").notNull(),

  hintOffered: boolean("hint_offered"),
  studentCorrect: boolean("student_correct"),
  judgePromptVersion: text("judge_prompt_version"),
  judgeModelId: text("judge_model_id"),
  judgeProviderId: text("judge_provider_id"),

  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  index("exchanges_session_id_idx").on(t.sessionId),
  unique("exchanges_session_index_unique").on(t.sessionId, t.index_),
]);

export const assessments = pgTable("assessments", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => studySessions.id),
  exchangeId: text("exchange_id").notNull().references(() => exchanges.id),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  timestamp: text("timestamp").notNull(),

  demonstratedUnderstanding: text("demonstrated_understanding").notNull().$type<"none" | "weak" | "developing" | "solid">(),
  explainedInOwnWords: boolean("explained_in_own_words").notNull(),
  guessedOrPatternMatched: boolean("guessed_or_pattern_matched").notNull(),
  recommendedBand: text("recommended_band").notNull().$type<"guiding" | "probing" | "minimal">(),
  rationale: text("rationale").notNull(),

  topicKey: text("topic_key"),

  assessorPromptVersion: text("assessor_prompt_version").notNull(),
  assessorModelId: text("assessor_model_id").notNull(),
  assessorProviderId: text("assessor_provider_id").notNull(),

  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  index("assessments_session_id_idx").on(t.sessionId),
  index("assessments_subject_id_idx").on(t.subjectId),
]);

/**
 * MasteryHistoryEntry — B2-motor-de-dominio.md §2, B3 §2.10. Append-only
 * (I-3): no `update`/`delete` call anywhere in this codebase ever targets
 * this table — `repositories/mastery.ts` only ever inserts. Defined BEFORE
 * `masteryStates` in this file because that table's `lastHistoryEntryId`
 * references it (I-2: a `MasteryState` never exists without its history
 * entry, same transaction).
 */
export const masteryHistoryEntries = pgTable("mastery_history_entries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  /** "" sentinel (SUBJECT_ROLLUP_TOPIC_KEY) = subject-level rollup, B3 I-9. */
  topicKey: text("topic_key").notNull(),
  /**
   * Optional UUID of the `Tema` in the subject's Temario. `null` means
   * subject-level rollup (same semantic as `topicKey === ""`). Added in P1.
   */
  topicId: text("topic_id"),
  level: jsonb("level").notNull().$type<{
    tier: "emerging" | "developing" | "consolidated" | "mastered";
    positiveStreak: number;
    negativeStreak: number;
    strongCount: number;
    recentStrongEvidence: Array<{ assessmentId: string; sessionId: string; timestamp: string }>;
    lastPositiveAt: string | null;
    lastPromotionAt: string | null;
  }>(),
  computedAt: text("computed_at").notNull(),
  /** `"b2-agg-1"` (B2_AGGREGATION_VERSION) or its `-correction` suffix (B2 §6.2/§7.3, F3 scope). */
  computedByVersion: text("computed_by_version").notNull(),
  /** Empty array = decay event (B2 §1.5), never a "no evidence" bug — see applyDecay's docblock. */
  contributingAssessmentIds: jsonb("contributing_assessment_ids").notNull().$type<string[]>(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  index("mastery_history_entries_user_subject_topic_idx").on(t.userId, t.subjectId, t.topicKey),
  index("mastery_history_entries_subject_topic_id_idx").on(t.subjectId, t.topicId),
]);

/**
 * MasteryState — B2-motor-de-dominio.md §2, B3 §2.10. ONE row per
 * `(userId, subjectId, topicKey)` (I-9) — the rollup row uses `topicKey: ""`
 * (SUBJECT_ROLLUP_TOPIC_KEY) and always exists once any Assessment lands for
 * that subject; per-topic rows only exist once materialized (B2 §3.2, ≥3
 * recurring normalized labels). Never written directly by a route — only
 * `repositories/mastery.ts`'s `writeMasteryState` (I-2: always the same
 * transaction as its `MasteryHistoryEntry`).
 */
export const masteryStates = pgTable("mastery_states", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  topicKey: text("topic_key").notNull(),
  /**
   * Optional UUID of the `Tema` in the subject's Temario. `null` means
   * subject-level rollup (same semantic as `topicKey === ""`). Added in P1.
   */
  topicId: text("topic_id"),
  currentLevel: jsonb("current_level").notNull().$type<{
    tier: "emerging" | "developing" | "consolidated" | "mastered";
    positiveStreak: number;
    negativeStreak: number;
    strongCount: number;
    recentStrongEvidence: Array<{ assessmentId: string; sessionId: string; timestamp: string }>;
    lastPositiveAt: string | null;
    lastPromotionAt: string | null;
  }>(),
  visibility: text("visibility").notNull().$type<"shadow" | "visible">(),
  lastHistoryEntryId: text("last_history_entry_id").notNull().references(() => masteryHistoryEntries.id),
  updatedAt: text("updated_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  unique("mastery_states_user_subject_topic_unique").on(t.userId, t.subjectId, t.topicKey),
  index("mastery_states_user_id_idx").on(t.userId),
  index("mastery_states_subject_id_idx").on(t.subjectId),
  index("mastery_states_subject_topic_id_idx").on(t.subjectId, t.topicId),
]);

export const usageQuotas = pgTable("usage_quotas", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  period: text("period").notNull().$type<"daily" | "monthly">(),
  periodKey: text("period_key").notNull(),
  tutorMessagesUsed: integer("tutor_messages_used").notNull().default(0),
  assessorCallsUsed: integer("assessor_calls_used").notNull().default(0),
  judgeCallsUsed: integer("judge_calls_used").notNull().default(0),
  ingestCloudCallsUsed: integer("ingest_cloud_calls_used").notNull().default(0),
  /** PB2: nullable — null = costo no medible (precio del modelo desconocido), no confundir con $0. */
  costUsdEstimate: real("cost_usd_estimate").default(0),
  /** PB5: true cuando al menos un recordUsage recibió costUsd=null — el total no es completo. */
  costUsdIncomplete: boolean("cost_usd_incomplete").notNull().default(false),
  capTutorMessages: integer("cap_tutor_messages"),
  capCostUsd: real("cap_cost_usd"),
  resetAt: text("reset_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  unique("usage_quotas_user_period_key_unique").on(t.userId, t.period, t.periodKey),
  index("usage_quotas_user_id_idx").on(t.userId),
]);

/** SafetyIncident — C-backend-plataforma.md §3.2. */
export const safetyIncidents = pgTable("safety_incidents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  sessionId: text("session_id").notNull(),
  exchangeId: text("exchange_id"),
  category: text("category").notNull().$type<"self_harm" | "abuse_disclosure" | "jailbreak_attempt" | "other">(),
  detectedAt: text("detected_at").notNull(),
  classifierProviderId: text("classifier_provider_id").notNull(),
  classifierModelId: text("classifier_model_id").notNull(),
  /**
   * Plan-xp-progreso Fase 3.1 — the exact student message that triggered the
   * block. A blocked turn never creates an Exchange, so the text must live
   * on the incident itself. Retained until a human sets reviewedAt.
   */
  triggeringText: text("triggering_text"),
  reviewedAt: text("reviewed_at"),
  reviewedBy: text("reviewed_by").$type<"founder" | null>(),
  reviewNotes: text("review_notes"),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [index("safety_incidents_user_id_idx").on(t.userId), index("safety_incidents_category_idx").on(t.category)]);

/**
 * Plan-xp-progreso Fase 3.2 — one row per quota rejection. Captures baseline
 * of how often beta students hit the ceiling (not stored anywhere before).
 */
export const quotaRejections = pgTable("quota_rejections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  /** Which limit was hit — mirrors QuotaCheckResult.reason (+ ingest variants). */
  reason: text("reason").notNull().$type<
    | "daily_messages"
    | "monthly_messages"
    | "cost_cap"
    | "daily_ingest_pages"
    | "monthly_ingest_pages"
  >(),
  /** Surface that rejected: tutor exchange vs material ingest. */
  surface: text("surface").notNull().$type<"tutor" | "ingest" | "guided_items">(),
  rejectedAt: text("rejected_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  index("quota_rejections_user_id_idx").on(t.userId),
  index("quota_rejections_rejected_at_idx").on(t.rejectedAt),
]);

/**
 * MagicLinkToken — WP5-only table (not in B3; auth mechanics are C2's own
 * concern). `tokenHash` (never the raw token) is what's stored and looked
 * up — see auth/magic-link.ts. `payload` carries the signup fields
 * (displayName/ageConfirmedAt/consents/countryCode/preferredLanguageCode)
 * so a "signup" purpose token can materialize the User row only once the
 * link is actually clicked (never persists an unconfirmed account).
 */
export const magicLinkTokens = pgTable("magic_link_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  email: text("email").notNull(),
  purpose: text("purpose").notNull().$type<"signup" | "login">(),
  userId: text("user_id"),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
}, (t) => [unique("magic_link_tokens_token_hash_unique").on(t.tokenHash), index("magic_link_tokens_email_idx").on(t.email)]);

/**
 * Streaks — B3 §2.11, B2 §1.7. ONE row per `(userId, kind)` — unique
 * constraint enforced at the application layer (upsert by userId+kind).
 * Racha de assessments APROBADOS, no de días (O-7).
 */
export const streaks = pgTable("streaks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull().$type<"assessment_approved">(),
  current: integer("current").notNull().default(0),
  longest: integer("longest").notNull().default(0),
  lastQualifyingAssessmentId: text("last_qualifying_assessment_id"),
  lastQualifyingAt: text("last_qualifying_at"),
  updatedAt: text("updated_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  uniqueIndex("streaks_user_kind_unique").on(t.userId, t.kind),
  index("streaks_user_id_idx").on(t.userId),
]);

/**
 * ChallengeDefinition — B3 §2.11, B2 §4.1. Catalog of challenges that
 * `maybeAwardAchievements` evaluates against. Versioned: a criteria change
 * produces a NEW row with a new version, never mutates an existing one.
 */
export const challengeDefinitions = pgTable("challenge_definitions", {
  id: text("id").primaryKey(),
  scope: jsonb("scope").notNull().$type<{ kind: "subject" | "topic" | "generic"; subjectId?: string; topicKey?: string }>(),
  titleKey: text("title_key").notNull(),
  descriptionKey: text("description_key").notNull(),
  version: text("version").notNull(),
  criteria: jsonb("criteria").notNull().$type<unknown>(),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
});

/**
 * Achievements — B3 §2.11, B2 §4.2-§4.3. One row per earned or revoked
 * achievement. Append-only: a revoked achievement is never deleted, only
 * marked `status: "revoked"` (I-11: NUNCA se reescribe la fila anterior).
 * `retryOf` FK self: a retry points back to the revoked row it replaces.
 */
export const achievements = pgTable("achievements", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  challengeDefinitionId: text("challenge_definition_id").notNull().references(() => challengeDefinitions.id),
  challengeDefinitionVersion: text("challenge_definition_version").notNull(),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  topicKey: text("topic_key"),
  earnedAt: text("earned_at").notNull(),
  status: text("status").notNull().$type<"earned" | "revoked">(),
  revokedAt: text("revoked_at"),
  revokedReason: text("revoked_reason"),
  evidenceAssessmentIds: jsonb("evidence_assessment_ids").notNull().$type<string[]>(),
  retryOf: text("retry_of"),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  index("achievements_user_id_idx").on(t.userId),
  index("achievements_subject_id_idx").on(t.subjectId),
  index("achievements_user_subject_idx").on(t.userId, t.subjectId),
]);

/**
 * Temario — ordered list of topics + milestones for a Subject.
 * One temario per subject (1:1). `generated_by` tracks provenance.
 */
export const temarios = pgTable("temarios", {
  id: text("id").primaryKey(),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  userId: text("user_id").notNull().references(() => users.id),
  generatedBy: text("generated_by").notNull().$type<"manual" | "ai" | "ai-edited">(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  uniqueIndex("temarios_subject_id_unique").on(t.subjectId),
  index("temarios_user_id_idx").on(t.userId),
]);

/** Tema — atomic study unit within a Temario. */
export const temas = pgTable("temas", {
  id: text("id").primaryKey(),
  temarioId: text("temario_id").notNull().references(() => temarios.id),
  order: integer("order").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().$type<"new" | "studying" | "done">(),
  stars: integer("stars").notNull().default(0),
  recommended: boolean("recommended").notNull().default(false),
  /** Syllabus unit/chapter label from a seed catalog, for grouping in the UI — NULL for own subjects (C1-b). */
  unitLabel: text("unit_label"),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  index("temas_temario_id_idx").on(t.temarioId),
  uniqueIndex("temas_temario_id_order_unique").on(t.temarioId, t.order),
]);

/** Hito — cumulative review milestone (partial/final exam) interleaved in the temario. */
export const hitos = pgTable("hitos", {
  id: text("id").primaryKey(),
  temarioId: text("temario_id").notNull().references(() => temarios.id),
  order: integer("order").notNull(),
  kind: text("kind").notNull().$type<"parcial" | "examen_final">(),
  title: text("title").notNull(),
  coversUpToOrder: integer("covers_up_to_order").notNull(),
  status: text("status").notNull().$type<"available" | "done">(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  index("hitos_temario_id_idx").on(t.temarioId),
  uniqueIndex("hitos_temario_id_order_unique").on(t.temarioId, t.order),
]);

/**
 * Fuente — text-only study material for a subject. The original binary is
 * discarded after ingestion; only the extracted text is persisted.
 */
export const fuentes = pgTable("fuentes", {
  id: text("id").primaryKey(),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  kind: text("kind").notNull().$type<"pdf" | "image">(),
  text: text("text").notNull(),
  tokens: integer("tokens"),
  createdAt: text("created_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  index("fuentes_subject_id_idx").on(t.subjectId),
  index("fuentes_user_id_idx").on(t.userId),
]);

/**
 * TopicItems — cached guided-session item batch for a topic (plan-sesion-guiada D-S04).
 * One row per (subject, topic). The jsonb blob is a success `TopicItemsPayload`,
 * an in-flight claim (`status: generating`), or a first-gen failure cooldown
 * (`status: generation_failed`). No SQL migration: same jsonb column.
 */
export type TopicItemsStoredPayload =
  | {
      items: unknown[];
      grounding?: string;
      generatorVersion?: string;
      regeneratingAt?: string;
      generationFailedAt?: string;
      status?: undefined;
    }
  | {
      status: "generating";
      claimedAt: string;
      generatorVersion: string;
      grounding: string;
    }
  | {
      status: "generation_failed";
      failedAt: string;
      generatorVersion: string;
      grounding: string;
    };

export const topicItems = pgTable("topic_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  topicId: text("topic_id").notNull(),
  payload: jsonb("payload").notNull().$type<TopicItemsStoredPayload>(),
  generatedAt: text("generated_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  uniqueIndex("topic_items_subject_id_topic_id_unique").on(t.subjectId, t.topicId),
  index("topic_items_user_id_idx").on(t.userId),
]);

/**
 * Proactive tutor opening for an empty topic session — separate from
 * `exchanges` so we never fabricate Exchange.studentMessage.
 * One row per session (unique session_id). A `generating` row is the
 * in-flight claim (taken BEFORE the model call); `ready` is the persisted
 * opening. Payload columns are null while generating.
 */
export const sessionOpenings = pgTable("session_openings", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => studySessions.id),
  userId: text("user_id").notNull().references(() => users.id),
  /** Tutor-authored opening shown via TutorMessage. Null while generating. */
  text: text("text"),
  tutorModelId: text("tutor_model_id"),
  tutorProviderId: text("tutor_provider_id"),
  tutorPromptVersion: text("tutor_prompt_version"),
  grounding: text("grounding").$type<"fuentes" | "general">(),
  status: text("status").notNull().$type<"generating" | "ready">(),
  claimedAt: text("claimed_at").notNull(),
  createdAt: text("created_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  uniqueIndex("session_openings_session_id_unique").on(t.sessionId),
  index("session_openings_user_id_idx").on(t.userId),
  check("session_openings_status_check", sql`"status" IN ('generating', 'ready')`),
  check(
    "session_openings_grounding_check",
    sql`"grounding" IS NULL OR "grounding" IN ('fuentes', 'general')`,
  ),
  check(
    "session_openings_ready_payload_check",
    sql`("status" = 'generating') OR ("status" = 'ready' AND "text" IS NOT NULL AND char_length("text") > 0 AND "tutor_model_id" IS NOT NULL AND "tutor_provider_id" IS NOT NULL AND "tutor_prompt_version" IS NOT NULL AND "grounding" IS NOT NULL)`,
  ),
]);

/** XpEvent — signed XP delta from assessor-driven mastery or guided session. */
export const xpEvents = pgTable("xp_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  subjectId: text("subject_id").references(() => subjects.id),
  topicId: text("topic_id"),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  assessmentRef: jsonb("assessment_ref").$type<{ assessmentId: string; sessionId: string } | null>(),
  /** Guided session metadata (D-S06 / D-S08) — nullable for legacy assessor events. */
  itemId: text("item_id"),
  itemType: text("item_type"),
  difficulty: integer("difficulty"),
  correct: boolean("correct"),
  responseMs: integer("response_ms"),
  attempt: integer("attempt"),
  createdAt: text("created_at").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  index("xp_events_user_id_idx").on(t.userId),
  index("xp_events_subject_id_idx").on(t.subjectId),
  index("xp_events_user_subject_idx").on(t.userId, t.subjectId),
]);

/**
 * Turn idempotency claims — beta-real 10.
 *
 * Exchanges are persisted only AFTER the tutor stream finishes, so a unique
 * index on `exchanges` cannot catch a duplicate POST that arrives while the
 * first is still speaking. This table claims `(session_id, client_message_id)`
 * BEFORE the tutor call; completing `exchange_id` happens at persist time.
 */
export const turnClaims = pgTable("turn_claims", {
  sessionId: text("session_id").notNull().references(() => studySessions.id),
  clientMessageId: text("client_message_id").notNull(),
  /** Null while the tutor turn is in flight; set when the Exchange is persisted. */
  exchangeId: text("exchange_id").references(() => exchanges.id),
  createdAt: text("created_at").notNull(),
}, (t) => [
  primaryKey({ name: "turn_claims_pkey", columns: [t.sessionId, t.clientMessageId] }),
  index("turn_claims_session_id_idx").on(t.sessionId),
]);

/**
 * plan-modal-rag F0.1 — durable truncation metrics (Render logs are ephemeral).
 * One row per context build. Identifiers + numbers only — never material text.
 */
export const fuentesContextMetrics = pgTable("fuentes_context_metrics", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  sessionId: text("session_id").notNull().references(() => studySessions.id),
  kind: text("kind").notNull().$type<"topic" | "milestone">(),
  builder: text("builder").notNull().$type<"fuentes" | "topic">(),
  fuenteCount: integer("fuente_count").notNull(),
  corpusTokens: integer("corpus_tokens").notNull(),
  truncated: boolean("truncated").notNull(),
  droppedTokens: integer("dropped_tokens").notNull(),
}, (t) => [
  index("fuentes_context_metrics_subject_created_idx").on(t.subjectId, t.createdAt),
]);

/**
 * plan-modal-rag F2 — Fuente text chunks + embeddings (pgvector).
 * Nobody reads this yet (F3 wires retrieval). Additive only; subject-scoped (D4).
 * `fuente_name` travels with every chunk so citations can say "Guía de Química"
 * without a join at retrieval time.
 */
export const fuenteChunks = pgTable("fuente_chunks", {
  id: text("id").primaryKey(),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  fuenteId: text("fuente_id").notNull().references(() => fuentes.id),
  fuenteName: text("fuente_name").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  embedding: vector("embedding", { dimensions: FUENTE_CHUNK_EMBEDDING_DIMS }).notNull(),
  modelId: text("model_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [
  uniqueIndex("fuente_chunks_fuente_id_chunk_index_unique").on(t.fuenteId, t.chunkIndex),
  index("fuente_chunks_subject_id_idx").on(t.subjectId),
  index("fuente_chunks_embedding_hnsw_idx")
    .using("hnsw", t.embedding.op("vector_cosine_ops")),
]);

export const schema = {
  users,
  consents,
  courses,
  subjects,
  materialAssets,
  studySessions,
  exchanges,
  assessments,
  masteryHistoryEntries,
  masteryStates,
  usageQuotas,
  safetyIncidents,
  quotaRejections,
  magicLinkTokens,
  streaks,
  challengeDefinitions,
  achievements,
  temarios,
  temas,
  hitos,
  fuentes,
  topicItems,
  sessionOpenings,
  xpEvents,
  turnClaims,
  fuentesContextMetrics,
  fuenteChunks,
};
