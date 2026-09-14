/**
 * Executable invariants — B3-modelo-de-dominio.md §7 ("Invariantes y reglas
 * de integridad", I-1 through I-12). Each function name is traceable to its
 * spec id in a leading comment. These are pure data-shape checks — no I/O,
 * no store access. Callers (C2 write paths, tests, harness migrators) call
 * them at the point a write is about to happen; each throws
 * `DomainInvariantError` (naming the violated invariant id) on violation
 * and returns void on success.
 *
 * Some invariants (I-2, I-3, I-6) describe write-path discipline ("only the
 * aggregator writes X", "never mutate a row in place") that a single pure
 * function can't fully enforce without seeing the store. Where that's the
 * case, the function here checks the strongest executable proxy: given the
 * previous state and the proposed next state (or a candidate against its
 * history), does the pair respect the invariant's consistency contract.
 */
import { sanitizeSubject } from "@buxo/core/subject";
import type { Assessment } from "./assessment";
import type { Exchange } from "./exchange";
import type { MasteryHistoryEntry, MasteryState } from "./mastery";
import type { Consent } from "./consent";
import type { Course } from "./course";
import type { GradeLevel } from "./education-catalog";
import type { MaterialDigestionStatus } from "./material-asset";
import type { UsageQuota } from "./usage-quota";
import type { Achievement, AchievementStatus } from "./gamification";
import type { Fuente } from "./fuente";
import { FuenteTextOnlySchema } from "./fuente";
import type { Hito, Tema, Temario } from "./temario";
import type { XpEvent } from "./xp";
import { isGuidedXpReason } from "./xp";

export class DomainInvariantError extends Error {
  constructor(
    public readonly invariantId: string,
    message: string,
  ) {
    super(`[${invariantId}] ${message}`);
    this.name = "DomainInvariantError";
  }
}

function fail(invariantId: string, message: string): never {
  throw new DomainInvariantError(invariantId, message);
}

/** Structural deep-equality for the plain-data shapes in this package (no functions/Dates/Maps to worry about). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((el, i) => deepEqual(el, b[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).sort();
  const bKeys = Object.keys(bObj).sort();
  if (aKeys.length !== bKeys.length || !aKeys.every((k, i) => k === bKeys[i])) return false;
  return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
}

// ---------------------------------------------------------------------------
// I-1 — Assessment.exchangeId FK, same session as the Assessment
// ---------------------------------------------------------------------------

/**
 * I-1: Un `Assessment` siempre referencia exactamente un `Exchange`; ese
 * `Exchange` debe pertenecer al mismo `sessionId` que el `Assessment`
 * declara.
 */
export function assertAssessmentReferencesExchange(assessment: Assessment, exchange: Exchange): void {
  if (assessment.exchangeId !== exchange.id) {
    fail("I-1", `Assessment.exchangeId (${assessment.exchangeId}) does not match Exchange.id (${exchange.id})`);
  }
  if (assessment.sessionId !== exchange.sessionId) {
    fail(
      "I-1",
      `Assessment.sessionId (${assessment.sessionId}) does not match Exchange.sessionId (${exchange.sessionId})`,
    );
  }
}

// ---------------------------------------------------------------------------
// I-2 — MasteryState is only ever written together with its history entry
// ---------------------------------------------------------------------------

/**
 * I-2: `MasteryState` (el puntero "actual") nunca se edita a mano ni se
 * muta directamente: solo el job de agregación de B2 lo escribe, y siempre
 * junto con la `MasteryHistoryEntry` correspondiente (misma operación).
 * Executable proxy: the pair must be mutually consistent — same identity
 * tuple, `lastHistoryEntryId` pointing at the entry, and `currentLevel`
 * equal to the entry's `level`.
 */
export function assertMasteryStateWrittenWithHistoryEntry(state: MasteryState, entry: MasteryHistoryEntry): void {
  if (state.lastHistoryEntryId !== entry.id) {
    fail("I-2", `MasteryState.lastHistoryEntryId (${state.lastHistoryEntryId}) does not match entry.id (${entry.id})`);
  }
  if (state.userId !== entry.userId || state.subjectId !== entry.subjectId || state.topicKey !== entry.topicKey) {
    fail("I-2", "MasteryState (userId, subjectId, topicKey) does not match its MasteryHistoryEntry");
  }
  if (!deepEqual(state.currentLevel, entry.level)) {
    fail("I-2", "MasteryState.currentLevel does not match its MasteryHistoryEntry.level");
  }
}

// ---------------------------------------------------------------------------
// I-3 — MasteryHistoryEntry append-only
// ---------------------------------------------------------------------------

/**
 * I-3: `MasteryHistoryEntry` es append-only: una vez escrita, nunca se
 * actualiza in place.
 */
export function assertMasteryHistoryEntryImmutable(
  previous: MasteryHistoryEntry,
  next: MasteryHistoryEntry,
): void {
  if (previous.id !== next.id) {
    fail("I-3", "assertMasteryHistoryEntryImmutable called with two different ids — nothing to compare");
  }
  if (!deepEqual(previous, next)) {
    fail("I-3", `MasteryHistoryEntry ${previous.id} was mutated in place — append-only`);
  }
}

// ---------------------------------------------------------------------------
// I-4 — Exchange immutability (studentMessage/tutorReply/band frozen;
// judge* fields settle from null exactly once)
// ---------------------------------------------------------------------------

const JUDGE_FIELDS = ["hintOffered", "studentCorrect", "judgePromptVersion", "judgeModelId", "judgeProviderId"] as const;

/**
 * I-4: `Exchange` es inmutable una vez escrito: `studentMessage`/
 * `tutorReply`/`band` nunca se editan tras creación. Los campos `judge*`
 * pueden pasar de `null` a un valor exactamente una vez; nunca se
 * sobreescribe un veredicto ya no-nulo.
 */
export function assertExchangeImmutable(previous: Exchange, next: Exchange): void {
  if (previous.id !== next.id) {
    fail("I-4", "assertExchangeImmutable called with two different ids — nothing to compare");
  }
  if (previous.studentMessage !== next.studentMessage) fail("I-4", "Exchange.studentMessage was edited");
  if (previous.tutorReply !== next.tutorReply) fail("I-4", "Exchange.tutorReply was edited");
  if (previous.band !== next.band) fail("I-4", "Exchange.band was edited");

  for (const field of JUDGE_FIELDS) {
    const prevValue = previous[field];
    const nextValue = next[field];
    if (prevValue !== null && nextValue !== prevValue) {
      fail("I-4", `Exchange.${field} was already non-null (${String(prevValue)}) and got overwritten`);
    }
  }
}

// ---------------------------------------------------------------------------
// I-5 — version fields non-null on newly written records
// ---------------------------------------------------------------------------

function isNonEmpty(value: string | null): value is string {
  return value !== null && value.length > 0;
}

/**
 * I-5: toda entidad que registra el juicio de un modelo debe tener sus
 * campos de versión no-nulos al momento de escribirse (bloque tutor* de
 * `Exchange`); el bloque judge* debe estar completo o completamente
 * ausente (§3: "nullable en conjunto").
 */
export function assertExchangeVersionFieldsPresent(exchange: Exchange): void {
  if (!isNonEmpty(exchange.tutorPromptVersion)) fail("I-5", "Exchange.tutorPromptVersion must be non-empty");
  if (!isNonEmpty(exchange.tutorModelId)) fail("I-5", "Exchange.tutorModelId must be non-empty");
  if (!isNonEmpty(exchange.tutorProviderId)) fail("I-5", "Exchange.tutorProviderId must be non-empty");

  const judgeValues = [exchange.judgePromptVersion, exchange.judgeModelId, exchange.judgeProviderId];
  const allNull = judgeValues.every((v) => v === null);
  const allPresent = judgeValues.every((v) => isNonEmpty(v));
  if (!allNull && !allPresent) {
    fail("I-5", "Exchange judge* version fields must be all-null or all-present together");
  }
}

/** I-5 applied to Assessment.assessor* fields. */
export function assertAssessmentVersionFieldsPresent(assessment: Assessment): void {
  if (!isNonEmpty(assessment.assessorPromptVersion)) fail("I-5", "Assessment.assessorPromptVersion must be non-empty");
  if (!isNonEmpty(assessment.assessorModelId)) fail("I-5", "Assessment.assessorModelId must be non-empty");
  if (!isNonEmpty(assessment.assessorProviderId)) fail("I-5", "Assessment.assessorProviderId must be non-empty");
}

/** I-5 applied to MasteryHistoryEntry.computedByVersion. */
export function assertMasteryHistoryEntryVersionFieldPresent(entry: MasteryHistoryEntry): void {
  if (!isNonEmpty(entry.computedByVersion)) fail("I-5", "MasteryHistoryEntry.computedByVersion must be non-empty");
}

// ---------------------------------------------------------------------------
// I-6 — Consent append-only ledger
// ---------------------------------------------------------------------------

/**
 * I-6: los registros de `Consent` son append-only: retirar un
 * consentimiento crea una fila nueva (`status:"withdrawn"`) en vez de
 * borrar la fila de aceptación.
 */
export function assertConsentAppendOnly(history: Consent[], candidate: Consent): void {
  if (history.some((c) => c.id === candidate.id)) {
    fail("I-6", `Consent ${candidate.id} already exists — append-only ledger, ids are never reused`);
  }
  if (candidate.status === "withdrawn") {
    const hasPriorAcceptance = history.some(
      (c) =>
        c.userId === candidate.userId &&
        c.type === candidate.type &&
        c.status === "accepted" &&
        c.occurredAt <= candidate.occurredAt,
    );
    if (!hasPriorAcceptance) {
      fail("I-6", `Consent withdrawal for (${candidate.userId}, ${candidate.type}) has no prior acceptance row`);
    }
  }
}

// ---------------------------------------------------------------------------
// I-7 — Course.gradeLevelId must reference an enabled GradeLevel at creation
// ---------------------------------------------------------------------------

/**
 * I-7: `Course.gradeLevelId` debe referenciar un `GradeLevel` con
 * `enabled: true` en el momento de la creación del curso.
 */
export function assertCourseGradeLevelEnabledAtCreation(course: Course, gradeLevel: GradeLevel): void {
  if (course.gradeLevelId !== gradeLevel.id) {
    fail("I-7", `Course.gradeLevelId (${course.gradeLevelId}) does not match GradeLevel.id (${gradeLevel.id})`);
  }
  if (!gradeLevel.enabled) {
    fail("I-7", `GradeLevel ${gradeLevel.id} is not enabled — cannot create a Course against it`);
  }
}

// ---------------------------------------------------------------------------
// I-8 — MaterialAsset digestion status state machine
// ---------------------------------------------------------------------------

const MATERIAL_STATUS_TRANSITIONS: Record<MaterialDigestionStatus, readonly MaterialDigestionStatus[]> = {
  pending: ["digesting"],
  digesting: ["ready", "partial", "failed"],
  ready: [],
  partial: [],
  failed: [],
};

/**
 * I-8: el estado de digestión de `MaterialAsset` sigue la máquina de
 * estados `pending → digesting → (ready | partial | failed)`.
 */
export function assertMaterialAssetStatusTransition(
  from: MaterialDigestionStatus,
  to: MaterialDigestionStatus,
): void {
  const allowed = MATERIAL_STATUS_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    fail("I-8", `MaterialAsset status transition ${from} -> ${to} is not allowed`);
  }
}

// ---------------------------------------------------------------------------
// I-9 — MasteryState/MasteryHistoryEntry identity is scoped to subjectId
// ---------------------------------------------------------------------------

/**
 * I-9: `(userId, subjectId, topicKey)` es la tupla de identidad real de
 * `MasteryState` — no hay agregación cruzada entre materias por
 * coincidencia de string de tema. Executable proxy: every Assessment that
 * contributed to a MasteryHistoryEntry must belong to that entry's
 * subjectId.
 */
export function assertMasteryHistoryEntryAssessmentsScopedToSubject(
  entry: MasteryHistoryEntry,
  contributingAssessments: Assessment[],
): void {
  const bySubject = new Map(contributingAssessments.map((a) => [a.id, a]));
  for (const id of entry.contributingAssessmentIds) {
    const assessment = bySubject.get(id);
    if (!assessment) {
      fail("I-9", `MasteryHistoryEntry references Assessment ${id} that was not provided for scoping check`);
    }
    if (assessment.subjectId !== entry.subjectId) {
      fail(
        "I-9",
        `Assessment ${id} has subjectId ${assessment.subjectId}, but MasteryHistoryEntry is scoped to ${entry.subjectId}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// I-10 — UsageQuota uniqueness and non-negative counters
// ---------------------------------------------------------------------------

/** I-10: `UsageQuota` es único por `(userId, period, periodKey)`. */
export function assertUsageQuotaUnique(quotas: UsageQuota[]): void {
  const seen = new Set<string>();
  for (const q of quotas) {
    const key = `${q.userId}::${q.period}::${q.periodKey}`;
    if (seen.has(key)) {
      fail("I-10", `Duplicate UsageQuota for (${q.userId}, ${q.period}, ${q.periodKey})`);
    }
    seen.add(key);
  }
}

/** I-10: sus contadores nunca son negativos. costUsdEstimate null (costo no medible, PB2) se salta la comprobación. */
export function assertUsageQuotaCountersNonNegative(quota: UsageQuota): void {
  const counters: Array<[string, number]> = [
    ["tutorMessagesUsed", quota.tutorMessagesUsed],
    ["assessorCallsUsed", quota.assessorCallsUsed],
    ["judgeCallsUsed", quota.judgeCallsUsed],
    ["ingestCloudCallsUsed", quota.ingestCloudCallsUsed],
  ];
  for (const [name, value] of counters) {
    if (value < 0) fail("I-10", `UsageQuota.${name} must not be negative (got ${value})`);
  }
  if (quota.costUsdEstimate !== null && quota.costUsdEstimate < 0) {
    fail("I-10", `UsageQuota.costUsdEstimate must not be negative (got ${quota.costUsdEstimate})`);
  }
}

// ---------------------------------------------------------------------------
// I-11 — Achievement status transitions and retry chains
// ---------------------------------------------------------------------------

const ACHIEVEMENT_STATUS_TRANSITIONS: Record<AchievementStatus, readonly AchievementStatus[]> = {
  earned: ["revoked"],
  revoked: [],
};

/**
 * I-11: `Achievement.status` es unidireccional: `earned → revoked` está
 * permitido; un reintento exitoso NUNCA reescribe la fila revocada.
 */
export function assertAchievementStatusTransition(from: AchievementStatus, to: AchievementStatus): void {
  const allowed = ACHIEVEMENT_STATUS_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    fail("I-11", `Achievement status transition ${from} -> ${to} is not allowed`);
  }
}

/** I-11: un reintento (`retryOf`) debe apuntar a una fila ya `revoked`, nunca a una `earned` (o inexistente). */
export function assertAchievementRetryReferencesRevoked(achievements: Achievement[], candidate: Achievement): void {
  if (candidate.retryOf === null) return;
  const target = achievements.find((a) => a.id === candidate.retryOf);
  if (!target) {
    fail("I-11", `Achievement.retryOf ${candidate.retryOf} does not reference an existing Achievement`);
  }
  if (target.status !== "revoked") {
    fail("I-11", `Achievement.retryOf ${candidate.retryOf} must reference a revoked Achievement (got ${target.status})`);
  }
}

// ---------------------------------------------------------------------------
// I-12 — Exchange only exists once the tutor turn is complete
// ---------------------------------------------------------------------------

/**
 * I-12: `Exchange` solo se crea una vez que el turno del tutor está
 * completo (mensaje del estudiante + respuesta del tutor, ambos
 * presentes). Un turno en streaming/interrumpido no es una entidad del
 * dominio.
 */
export function assertExchangeComplete(input: { studentMessage: string; tutorReply: string }): void {
  if (input.studentMessage.trim().length === 0) {
    fail("I-12", "Exchange cannot be created without a non-empty studentMessage");
  }
  if (input.tutorReply.trim().length === 0) {
    fail("I-12", "Exchange cannot be created without a non-empty tutorReply");
  }
}

// ---------------------------------------------------------------------------
// P0 — Product model invariants (temario, fuente, xp, mastery by topic)
// ---------------------------------------------------------------------------

/** P0-1: a Temario belongs to exactly one (subjectId, userId) tuple. */
export function assertTemarioOwnedBySubjectUser(
  temario: Temario,
  subjectId: string,
  userId: string,
): void {
  if (temario.subjectId !== subjectId) {
    fail("P0-1", `Temario.subjectId (${temario.subjectId}) does not match caller subject (${subjectId})`);
  }
  if (temario.userId !== userId) {
    fail("P0-1", `Temario.userId (${temario.userId}) does not match caller user (${userId})`);
  }
}

/** P0-2: topic titles must already be sanitized by `sanitizeSubject` (R6). */
export function assertTopicTitleSanitized(title: string): void {
  const sanitized = sanitizeSubject(title);
  if (sanitized !== title) {
    fail("P0-2", "Topic title is not sanitized (R6)");
  }
}

/** P0-3: `stars` and `status='done'` are only written by the assessor flow. */
export function assertStarsSetOnlyByAssessor(topic: Tema, writer: "client" | "assessor"): void {
  if (writer === "client" && (topic.stars !== 0 || topic.status === "done")) {
    fail("P0-3", "Client cannot set stars or mark a topic as done");
  }
}

/** P0-4: a topic-scoped MasteryHistoryEntry must reference a topic in the subject's temario. */
export function assertMasteryTopicScopedToSubject(
  entry: MasteryHistoryEntry,
  allowedTopicIds: Set<string>,
): void {
  if (entry.topicId === undefined || entry.topicId === null) return;
  if (!allowedTopicIds.has(entry.topicId)) {
    fail("P0-4", `MasteryHistoryEntry.topicId (${entry.topicId}) is not in the subject temario`);
  }
}

/** P0-5: a milestone cannot claim to cover beyond the last existing topic. */
export function assertHitoCoversWithinTemario(hito: Hito, maxTopicOrder: number): void {
  if (hito.coversUpToOrder > maxTopicOrder) {
    fail(
      "P0-5",
      `Hito.coversUpToOrder (${hito.coversUpToOrder}) exceeds max topic order (${maxTopicOrder})`,
    );
  }
}

/** P0-6: a Fuente is text-only and must not carry binary/storage fields. */
export function assertFuenteTextOnly(fuente: Fuente): void {
  const result = FuenteTextOnlySchema.safeParse(fuente);
  if (!result.success) {
    fail("P0-6", `Fuente is not text-only: ${result.error.message}`);
  }
}

/**
 * P0-7: every XP delta must be traceable to an assessment, except guided-session
 * reasons (`guided_item_*`, `guided_session_complete`) which carry item metadata
 * instead and must have a null `assessmentRef`.
 */
export function assertXpOnlyFromAssessment(event: XpEvent): void {
  if (isGuidedXpReason(event.reason)) {
    if (event.assessmentRef !== null) {
      fail("P0-7", "Guided XpEvent must not reference an assessment");
    }
    return;
  }
  if (!event.assessmentRef?.assessmentId || event.assessmentRef.assessmentId.length === 0) {
    fail("P0-7", "XpEvent must reference an assessment");
  }
}

