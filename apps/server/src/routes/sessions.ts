/**
 * Study sessions + the tutor turn — C-backend §2.4/§3/§2.5/C3. This is
 * where auth, quota (§2.5), safety (§3, blocking), the tutor stream (C7),
 * the assessor (always, C7/D3), and the sampled judge (D3 §7) all meet for
 * one request.
 *
 * C3 authoritative-turn ordering for POST /:id/exchanges (§4: "Exchange
 * solo se crea cuando el turno del tutor está completo", I-12):
 *   0. optional `clientMessageId` claim (beta-real 10) — BEFORE tutor/quota
 *      spend; duplicates return `409 duplicate_turn` so a retry cannot
 *      invent a second Exchange while the first is still speaking.
 *   1. quota check (§2.5) — blocks before any model call if exceeded.
 *   2. safety classify the student's message (§3.1) — BLOCKING, before the
 *      tutor. On a match: persist SafetyIncident, respond with the static
 *      template (§3.2), never create an Exchange, never call the tutor.
 *   3. tutor streams the reply to the client immediately.
 *   4. once `result.text` resolves (the full reply, server-side only —
 *      never re-sent to the client, it already has it from the stream):
 *      persist the Exchange (I-12), complete the turn claim, record tutor
 *      quota usage, run the assessor (always — D3 "corre por intercambio"),
 *      apply its verdict via `applyAssessment` and persist a BandChange if
 *      it moved, feed the just-recorded Assessment into
 *      `applyAssessmentToMastery` (B2-motor-de-dominio.md §9.4 — mastery
 *      aggregation, shadow-only in F2), and SAMPLE the judge (D3 §7,
 *      `judgeSampleRate`) to backfill hint_offered/student_correct on the
 *      just-created Exchange.
 *
 * DEVIATION (flagged for architect review): C-backend §2.4's endpoint list
 * has ONE exchanges route with no separate `/v1/assess` or `/v1/judge`
 * endpoints (unlike the alfa's client-orchestrated
 * `/api/chat` + `/api/assess` + `/api/judge` split). Given C3 makes the
 * server authoritative for turn completion, this route runs assessor/judge
 * itself, server-side, after the stream finishes — no public assess/judge
 * endpoints exist. If the architect intends a client-driven split
 * (matching the alfa more literally) instead, this is the seam to change.
 *
 * DEVIATION #2 (F2 WQ2 Part 2, flagged for architect review): the plan's
 * WQ2 text scoped Part 2 to `apps/mobile` only, but "upload a guide
 * mid-session without losing the tutor thread" (the #1 validated friction
 * this whole wave exists to fix) is architecturally impossible without a
 * server hookup — `POST /v1/sessions` (above) only ever computes
 * `materialSnapshotTextRef` ONCE, at session creation; nothing let an
 * ALREADY-ACTIVE session pick up a newly-digested material. `POST
 * /:id/materials` below is the minimal addition that closes that gap:
 * attach a `MaterialAsset` (already digested via `POST /v1/materials`,
 * F2 WQ1/WQ2 Part 1) to a live session and recompute its snapshot with the
 * SAME combine+truncate logic session creation uses (`../materials/
 * snapshot.ts`, factored out of this file for that reuse). No new model
 * calls, no new quota surface — purely session bookkeeping.
 */
import { Hono } from "hono";
import { z } from "zod";
import { BANDS, type Band } from "@buxo/core/prompts";
import { applyAssessment, type AssessorMessage } from "@buxo/core/assess";
import { computeMilestoneScope } from "@buxo/domain/temario";
import { requireCapabilities } from "@buxo/models/registry";
import { estimateCostUsd } from "@buxo/models/capabilities";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";
import { findSubjectById } from "../repositories/subjects";
import { findMaterialById, findMaterialsByIds } from "../repositories/materials";
import { buildMaterialSnapshot } from "../materials/snapshot";
import {
  buildFuentesSourceText,
  buildTopicSessionContext,
  type FuentesContextMetrics,
} from "../materials/session-context";
import { recordFuentesContextMetrics } from "../repositories/fuentes-context-metrics";
import { listFuentesBySubject } from "../repositories/fuentes";
import { findTemarioBySubject, markTopicStudyingIfNew } from "../repositories/temarios";
import {
  createStudySession,
  findStudySessionById,
  listActiveStudySessions,
  currentBand,
  appendBandChange,
  attachMaterialToSession,
  touchStudySession,
  findMostRecentClosedSessionForTopic,
} from "../repositories/study-sessions";
import { createExchange, listExchangesBySession, recordJudgeVerdict } from "../repositories/exchanges";
import {
  claimSessionOpeningGeneration,
  completeSessionOpeningGeneration,
  findReadySessionOpeningBySessionId,
  OPENING_IN_FLIGHT_POLL_MS,
  OPENING_IN_FLIGHT_TIMEOUT_MS,
  releaseSessionOpeningClaim,
  waitForReadySessionOpening,
} from "../repositories/session-openings";
import {
  buildOpeningTutorMessages,
  prependOpeningToTutorMessages,
  resolveOpeningGrounding,
} from "../sessions/opening";
import { claimTurn, completeTurnClaim, releaseTurnClaim } from "../repositories/turn-claims";
import { recordAssessment } from "../repositories/assessments";
import { checkTutorQuota, recordQuotaUsage } from "../quota/enforce";
import { createQuotaRejection } from "../repositories/quota-rejections";
import { createSafetyIncident } from "../repositories/safety-incidents";
import { staticReplyFor } from "../safety/templates";
import { runAssessor } from "../models/assess";
import { runJudge } from "../models/judge";
import { applyAssessmentToMastery } from "../mastery/aggregate";
import { applyGamificationAfterMastery } from "../mastery/gamification-wiring";
import { normalizePreferredLanguageCode } from "../locale";
import { findUserById } from "../repositories/users";

const CreateSessionSchema = z
  .object({
    subjectId: z.string().min(1),
    materialAssetIds: z.array(z.string().min(1)).optional(),
    initialBand: z.enum(BANDS).optional(),
    /** P5 (DF-P12) — opens the session scoped to one topic. Mutually exclusive with milestoneId. */
    topicId: z.string().min(1).optional(),
    /** P5 (DF-P05) — opens a milestone review-round session instead of a normal topic one. Mutually exclusive with topicId. */
    milestoneId: z.string().min(1).optional(),
  })
  .refine((body) => !(body.topicId && body.milestoneId), {
    message: "topicId and milestoneId are mutually exclusive — a session is either a topic session or a milestone review round, never both",
  });

const AttachMaterialSchema = z.object({ materialAssetId: z.string().min(1) });

/** `clientMessageId` OPTIONAL — old APKs omit it; behaviour stays pre-idempotency (beta-real 10). */
const ExchangeSchema = z.object({
  studentMessage: z.string().min(1),
  clientMessageId: z.string().min(1).max(128).optional(),
});

export function createSessionsRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.post("/", async (c) => {
    const parsed = CreateSessionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);
    const userId = c.get("userId");

    const subject = await findSubjectById(deps.db, parsed.data.subjectId);
    if (!subject || subject.userId !== userId) return errorResponse(c, "not_found", "Subject not found");

    const materialAssetIds = parsed.data.materialAssetIds ?? [];
    const materials = await findMaterialsByIds(deps.db, userId, materialAssetIds);
    if (materials.length !== materialAssetIds.length) {
      return errorResponse(c, "invalid_request", "One or more materialAssetIds not found");
    }

    // P5 — validate topicId/milestoneId (if given) actually belong to this
    // subject's temario before opening a scoped session on them.
    let kind: "topic" | "milestone" = "topic";
    if (parsed.data.topicId || parsed.data.milestoneId) {
      const temario = await findTemarioBySubject(deps.db, subject.id);
      if (parsed.data.topicId) {
        if (!temario || !temario.topics.some((t) => t.id === parsed.data.topicId)) {
          return errorResponse(c, "not_found", "Topic not found in this subject's temario");
        }
      }
      if (parsed.data.milestoneId) {
        if (!temario || !temario.milestones.some((m) => m.id === parsed.data.milestoneId)) {
          return errorResponse(c, "not_found", "Milestone not found in this subject's temario");
        }
        kind = "milestone";
      }
    }

    const snapshot = buildMaterialSnapshot(materials);

    // Plan-xp-progreso Fase 4: reactivation opens a NEW session that
    // references the most recent closed one for the same topic.
    let previousSessionId: string | null = null;
    if (parsed.data.topicId) {
      const prior = await findMostRecentClosedSessionForTopic(deps.db, userId, parsed.data.topicId);
      previousSessionId = prior?.id ?? null;
    }

    const session = await createStudySession(deps.db, {
      userId,
      subjectId: subject.id,
      subjectNameSnapshot: subject.name,
      kind,
      topicId: parsed.data.topicId ?? null,
      milestoneId: parsed.data.milestoneId ?? null,
      previousSessionId,
      initialBand: parsed.data.initialBand ?? "guiding",
      materialAssetIds,
      materialSnapshotTextRef: snapshot.materialSnapshotTextRef,
      materialSnapshotInfo: snapshot.materialSnapshotInfo,
      materials,
    });

    // Plan-xp-progreso Fase 1.1: opening a topic session marks it studying.
    if (parsed.data.topicId) {
      await markTopicStudyingIfNew(deps.db, parsed.data.topicId);
    }

    return c.json(session, 201);
  });

  app.get("/", async (c) => {
    const userId = c.get("userId");
    const status = c.req.query("status");
    if (status !== undefined && status !== "active") {
      return errorResponse(c, "invalid_request", 'only status=active is supported (C3 §4: "sesiones retomables")');
    }
    const sessions = await listActiveStudySessions(deps.db, userId);
    const summaries = await Promise.all(
      sessions.map(async (s) => ({
        id: s.id,
        subjectId: s.subjectId,
        subjectNameSnapshot: s.subjectNameSnapshot,
        kind: s.kind,
        topicId: s.topicId,
        milestoneId: s.milestoneId,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        exchangeCount: (await listExchangesBySession(deps.db, s.id)).length,
      })),
    );
    return c.json(summaries);
  });

  app.get("/:id", async (c) => {
    const userId = c.get("userId");
    const session = await findStudySessionById(deps.db, userId, c.req.param("id"));
    if (!session) return errorResponse(c, "not_found", "Session not found");
    const [exchanges, opening] = await Promise.all([
      listExchangesBySession(deps.db, session.id),
      findReadySessionOpeningBySessionId(deps.db, session.id),
    ]);
    return c.json({ ...session, exchanges, opening });
  });

  /**
   * Generate-or-return the tutor opening for an empty topic session.
   * Idempotent: a retry returns the persisted row and does not call the model
   * again. Never writes an Exchange (no synthetic studentMessage).
   */
  app.post("/:id/opening", async (c) => {
    const userId = c.get("userId");
    const session = await findStudySessionById(deps.db, userId, c.req.param("id"));
    if (!session) return errorResponse(c, "not_found", "Session not found");
    if (session.status !== "active") return errorResponse(c, "conflict", "Session is not active");
    if (session.kind !== "topic" || !session.topicId) {
      return errorResponse(c, "conflict", "Opening is only available for empty topic sessions");
    }

    const existing = await findReadySessionOpeningBySessionId(deps.db, session.id);
    if (existing) return c.json(existing);

    const priorExchanges = await listExchangesBySession(deps.db, session.id);
    if (priorExchanges.length > 0) {
      return errorResponse(c, "conflict", "Session already has exchanges");
    }

    const user = await findUserById(deps.db, userId);
    if (!user) return errorResponse(c, "not_found", "User not found");

    const locale = normalizePreferredLanguageCode(user.preferredLanguageCode);
    const localeParam = locale === "en" ? ("en" as const) : undefined;

    const quotaResult = await checkTutorQuota(deps.db, userId, user.accountKind, deps.quotaConfig, deps.now());
    if (!quotaResult.ok) {
      await createQuotaRejection(deps.db, {
        userId,
        reason: quotaResult.reason,
        surface: "tutor",
      });
      return errorResponse(c, "quota_exceeded", `Tutor message quota exceeded (${quotaResult.reason})`);
    }

    let claim = await claimSessionOpeningGeneration(deps.db, {
      sessionId: session.id,
      userId,
      now: deps.now(),
    });
    if (claim.kind === "ready") return c.json(claim.opening);
    if (claim.kind === "in_flight") {
      const waited = await waitForReadySessionOpening(deps.db, session.id, {
        timeoutMs: OPENING_IN_FLIGHT_TIMEOUT_MS,
        intervalMs: OPENING_IN_FLIGHT_POLL_MS,
      });
      if (waited) return c.json(waited);
      claim = await claimSessionOpeningGeneration(deps.db, {
        sessionId: session.id,
        userId,
        now: deps.now(),
      });
      if (claim.kind === "ready") return c.json(claim.opening);
      if (claim.kind === "in_flight") {
        return errorResponse(c, "conflict", "Opening is already being generated");
      }
    }
    if (claim.kind !== "acquired") {
      return errorResponse(c, "conflict", "Opening is already being generated");
    }
    const claimId = claim.claimId;

    const fuentes = await listFuentesBySubject(deps.db, userId, session.subjectId);
    const temario = await findTemarioBySubject(deps.db, session.subjectId);
    const topicTitle = temario?.topics.find((t) => t.id === session.topicId)?.title ?? null;
    const material = buildTopicSessionContext({
      topicTitle,
      fuentes,
      materialSnapshotTextRef: session.materialSnapshotTextRef,
      meta: {
        subjectId: session.subjectId,
        sessionId: session.id,
        kind: session.kind,
      },
    });
    if (material?.metrics.subjectId && material.metrics.sessionId) {
      void recordFuentesContextMetrics(deps.db, material.metrics).catch((err) => {
        console.error(
          `[sessions] opening fuentes_context_metrics persist failed (session=${session.id}):`,
          err instanceof Error ? err.message : err,
        );
      });
    }
    const grounding = resolveOpeningGrounding({
      includedFuentesText: fuentes.some((f) => f.text.trim().length > 0),
    });

    let tutorReply: Awaited<ReturnType<typeof deps.models.tutorAdapter.streamReply>>;
    try {
      tutorReply = await deps.models.tutorAdapter.streamReply({
        messages: buildOpeningTutorMessages(),
        band: currentBand(session),
        material: material?.text,
        subject: session.subjectNameSnapshot,
        locale: localeParam,
      });
    } catch (err) {
      await releaseSessionOpeningClaim(deps.db, { sessionId: session.id, claimId });
      const message = err instanceof Error ? err.message : "Tutor chain exhausted";
      console.error(
        `[sessions] opening FALLÓ (session=${session.id} user=${userId}): ${message}`,
        err instanceof Error && err.stack ? `\n${err.stack}` : "",
      );
      return errorResponse(c, "upstream_error", message);
    }

    const fullText = (await Promise.resolve(tutorReply.result.text)).trim();
    if (!fullText) {
      await releaseSessionOpeningClaim(deps.db, { sessionId: session.id, claimId });
      return errorResponse(c, "upstream_error", "Tutor opening was empty");
    }

    const exchangesNow = await listExchangesBySession(deps.db, session.id);
    if (exchangesNow.length > 0) {
      await releaseSessionOpeningClaim(deps.db, { sessionId: session.id, claimId });
      return errorResponse(c, "conflict", "Session already has exchanges");
    }

    const { opening, completed } = await completeSessionOpeningGeneration(deps.db, {
      sessionId: session.id,
      claimId,
      text: fullText,
      tutorPromptVersion: tutorReply.promptVersion,
      tutorModelId: tutorReply.servedBy.modelId,
      tutorProviderId: tutorReply.servedBy.providerId,
      grounding,
    });

    if (completed) {
      const usage = await Promise.resolve(tutorReply.result.usage).catch(() => undefined);
      const capabilities = requireCapabilities("tutor", tutorReply.servedBy);
      const costUsd = usage ? estimateCostUsd(capabilities, usage.inputTokens ?? 0, usage.outputTokens ?? 0) : null;
      await recordQuotaUsage(deps.db, quotaResult.quotas, "tutor", costUsd);
      await touchStudySession(deps.db, session.id);
    }

    return c.json(opening);
  });

  /**
   * Attach a material to an ALREADY-ACTIVE session — see this file's
   * module doc, "DEVIATION #2". Idempotent (attaching an already-attached
   * `materialAssetId` is a no-op, returns the session unchanged) —
   * mid-session ingestion UI (`apps/mobile`) can safely retry without
   * double-counting.
   */
  app.post("/:id/materials", async (c) => {
    const userId = c.get("userId");
    const session = await findStudySessionById(deps.db, userId, c.req.param("id"));
    if (!session) return errorResponse(c, "not_found", "Session not found");
    if (session.status !== "active") return errorResponse(c, "conflict", "Session is not active");

    const parsed = AttachMaterialSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);

    if (session.materialAssetIds.includes(parsed.data.materialAssetId)) {
      return c.json(session);
    }

    const material = await findMaterialById(deps.db, userId, parsed.data.materialAssetId);
    if (!material) return errorResponse(c, "not_found", "Material not found");

    const materialAssetIds = [...session.materialAssetIds, material.id];
    const materials = await findMaterialsByIds(deps.db, userId, materialAssetIds);
    const snapshot = buildMaterialSnapshot(materials);

    const updated = await attachMaterialToSession(deps.db, session.id, materialAssetIds, snapshot, material);
    return c.json(updated);
  });

  app.post("/:id/exchanges", async (c) => {
    const userId = c.get("userId");
    const session = await findStudySessionById(deps.db, userId, c.req.param("id"));
    if (!session) return errorResponse(c, "not_found", "Session not found");
    if (session.status !== "active") return errorResponse(c, "conflict", "Session is not active");

    const parsed = ExchangeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);
    const studentMessage = parsed.data.studentMessage;
    const clientMessageId = parsed.data.clientMessageId;

    // Idempotency claim BEFORE quota/tutor (beta-real 10): a duplicate must
    // not burn another model call. Released on any path that never starts
    // streaming so a failed first attempt does not trap the student for 10 min.
    let claimHeld = false;
    if (clientMessageId) {
      const claimResult = await claimTurn(deps.db, {
        sessionId: session.id,
        clientMessageId,
        now: deps.now(),
      });
      if (claimResult.kind === "duplicate") {
        return errorResponse(
          c,
          "duplicate_turn",
          claimResult.claim.exchangeId
            ? "This turn was already completed — reconcile via GET session"
            : "This turn is already in flight — reconcile via GET session",
        );
      }
      claimHeld = true;
    }
    const releaseClaimIfHeld = async () => {
      if (!claimHeld || !clientMessageId) return;
      await releaseTurnClaim(deps.db, { sessionId: session.id, clientMessageId });
      claimHeld = false;
    };

    const user = await findUserById(deps.db, userId);
    if (!user) {
      await releaseClaimIfHeld();
      return errorResponse(c, "not_found", "User not found");
    }

    // Slice localización (A3b s4/AJUSTE 4): la preferred language del
    // estudiante llega a los prompts de tutor/milestone/assessor. SOLO "en"
    // se pasa como opción — "es" (el default de toda la base instalada, que
    // nunca eligió idioma) queda `undefined` para que el render sea
    // byte-idéntico al histórico y la versión persistida la default
    // validada. El judge no se toca: su prompt es una rúbrica de dos flags
    // booleanos, no produce texto libre (ver models/judge.ts).
    const locale = normalizePreferredLanguageCode(user.preferredLanguageCode);
    const localeParam = locale === "en" ? ("en" as const) : undefined;

    // §2.5 — quota check BEFORE any model call.
    const quotaResult = await checkTutorQuota(deps.db, userId, user.accountKind, deps.quotaConfig, deps.now());
    if (!quotaResult.ok) {
      await releaseClaimIfHeld();
      // Plan-xp-progreso Fase 3.2 — persist the rejection for baseline data.
      await createQuotaRejection(deps.db, {
        userId,
        reason: quotaResult.reason,
        surface: "tutor",
      });
      return errorResponse(c, "quota_exceeded", `Tutor message quota exceeded (${quotaResult.reason})`);
    }

    // §3.1 — BLOCKING safety classification, before the tutor.
    const classification = await deps.safetyClassifier.classify(studentMessage);
    if (classification.category !== "none") {
      await releaseClaimIfHeld();
      const incident = await createSafetyIncident(deps.db, {
        userId,
        sessionId: session.id,
        exchangeId: null,
        category: classification.category,
        classifierProviderId: classification.providerId,
        classifierModelId: classification.modelId,
        // Plan-xp-progreso Fase 3.1 — blocked turns never create an Exchange;
        // the triggering text must live on the incident itself.
        triggeringText: studentMessage,
      });
      await deps.safetyNotifier.notify(incident);
      return c.text(staticReplyFor(classification.category, user.preferredLanguageCode), 200, { "content-type": "text/plain; charset=utf-8" });
    }

    const priorExchanges = await listExchangesBySession(deps.db, session.id);
    const band = currentBand(session);
    const openingForHistory = await findReadySessionOpeningBySessionId(deps.db, session.id);

    const tutorMessages = prependOpeningToTutorMessages(
      openingForHistory?.text,
      priorExchanges,
      studentMessage,
    );

    // P5 (DF-P12/DF-P05) — every session leans on the subject's Fuentes,
    // refetched fresh on EVERY turn (never cached at session-creation time
    // like the legacy materialSnapshotTextRef) so a Fuente added mid-chat
    // via SourcesModal shows up in the very next turn with no separate
    // "attach" step — see `../materials/session-context.ts`'s module doc.
    const fuentes = await listFuentesBySubject(deps.db, userId, session.subjectId);

    /** F0.1 — persist truncation metrics without awaiting (lost metric ≠ broken turn). */
    const persistContextMetrics = async (metrics: FuentesContextMetrics | undefined) => {
      if (!metrics?.subjectId || !metrics.sessionId) return;
      await recordFuentesContextMetrics(deps.db, metrics).catch((err) => {
        console.error(
          `[sessions] fuentes_context_metrics persist failed (session=${session.id}):`,
          err instanceof Error ? err.message : err,
        );
      });
    };

    let tutorReply: Awaited<ReturnType<typeof deps.models.tutorAdapter.streamReply>> | Awaited<ReturnType<typeof deps.models.milestoneAdapter.streamReply>>;
    try {
      if (session.kind === "milestone") {
        const temario = await findTemarioBySubject(deps.db, session.subjectId);
        const hito = temario?.milestones.find((m) => m.id === session.milestoneId);
        if (!temario || !hito) {
          await releaseClaimIfHeld();
          return errorResponse(c, "internal_error", "Milestone session refers to a milestone that no longer exists");
        }
        // plan-modal-rag F0 — pass ids so truncation metrics correlate to beta subjects.
        const sources = buildFuentesSourceText(fuentes, {
          subjectId: session.subjectId,
          sessionId: session.id,
          kind: session.kind,
        });
        await persistContextMetrics(sources?.metrics);
        tutorReply = await deps.models.milestoneAdapter.streamReply({
          messages: tutorMessages,
          subjectName: session.subjectNameSnapshot,
          milestoneKind: hito.kind,
          milestoneTitle: hito.title,
          topics: computeMilestoneScope(temario, hito.id),
          sourcesText: sources?.text,
          locale: localeParam,
        });
      } else {
        let topicTitle: string | null = null;
        if (session.topicId) {
          const temario = await findTemarioBySubject(deps.db, session.subjectId);
          topicTitle = temario?.topics.find((t) => t.id === session.topicId)?.title ?? null;
        }
        const material = buildTopicSessionContext({
          topicTitle,
          fuentes,
          materialSnapshotTextRef: session.materialSnapshotTextRef,
          meta: {
            subjectId: session.subjectId,
            sessionId: session.id,
            kind: session.kind,
          },
        });
        await persistContextMetrics(material?.metrics);
        tutorReply = await deps.models.tutorAdapter.streamReply({
          messages: tutorMessages,
          band,
          material: material?.text,
          subject: session.subjectNameSnapshot,
          locale: localeParam,
        });
      }
    } catch (err) {
      await releaseClaimIfHeld();
      const message = err instanceof Error ? err.message : "Tutor chain exhausted";
      // LOGUEAR, no solo responder. Antes esto devolvía el motivo real del
      // proveedor al cliente y NO escribía nada: el cliente lo descartaba
      // mostrando "revisá tu conexión", así que una caída del tutor era
      // invisible en los logs de Render Y mal atribuida en la app. El founder
      // no tuvo forma de diagnosticar su propia caída del 2026-07-29.
      console.error(
        `[sessions] tutor FALLÓ (session=${session.id} kind=${session.kind} user=${userId}): ${message}`,
        err instanceof Error && err.stack ? `\n${err.stack}` : "",
      );
      return errorResponse(c, "upstream_error", message);
    }

    const response = tutorReply.result.toTextStreamResponse();

    /**
     * ¿Llegó a existir el Exchange? Decide si un fallo post-streaming debe
     * LIBERAR el reclamo (beta-real 10, arista que el plan no cubrió).
     *
     * Si el tutor empieza a hablar y muere a mitad del streaming, el Exchange
     * nunca se persiste y el reclamo queda con `exchange_id` nulo. Sin liberarlo,
     * el estudiante **no puede reenviar ese mismo mensaje durante 10 minutos**:
     * cada reintento choca con el reclamo, la reconciliación por GET no encuentra
     * nada, y ve el error en bucle hasta que el huérfano vence.
     *
     * Con el Exchange ya persistido NO se libera: ahí el duplicado es real y el
     * reclamo tiene que seguir protegiendo.
     */
    let exchangePersisted = false;

    // Fire-and-forget: persist the Exchange only once the full reply is in
    // hand (I-12), then run the assessor + sampled judge. Never blocks or
    // breaks the streamed response already returned to the client.
    void Promise.resolve(tutorReply.result.text)
      .then(async (fullReply) => {
        const usage = await Promise.resolve(tutorReply.result.usage).catch(() => undefined);
        const capabilities = requireCapabilities("tutor", tutorReply.servedBy);
        const costUsd = usage ? estimateCostUsd(capabilities, usage.inputTokens ?? 0, usage.outputTokens ?? 0) : null;

        const exchange = await createExchange(deps.db, {
          sessionId: session.id,
          index: priorExchanges.length,
          studentMessage,
          tutorReply: fullReply,
          band,
          tutorPromptVersion: tutorReply.promptVersion,
          tutorModelId: tutorReply.servedBy.modelId,
          tutorProviderId: tutorReply.servedBy.providerId,
        });

        exchangePersisted = true;

        if (clientMessageId) {
          await completeTurnClaim(deps.db, {
            sessionId: session.id,
            clientMessageId,
            exchangeId: exchange.id,
          });
        }

        await recordQuotaUsage(deps.db, quotaResult.quotas, "tutor", costUsd);
        await touchStudySession(deps.db, session.id);

        // P5 (DF-P05): a milestone review round is NOT a scored tutor turn
        // — it never gates anything and nothing about it should derive
        // mastery/XP/streak (that would conflate "did well on a voluntary
        // review" with "demonstrated understanding in a real topic
        // session"). The Exchange above is still persisted (so the
        // transcript/resume-after-restart story works identically), and
        // the quota/cost above still counts the model call — only the
        // pedagogical assessor→mastery→gamification chain below is skipped.
        if (session.kind === "milestone") return;

        // ═══════════════════════════════════════════════════════════════════
        // DISEÑO DE DOS MODELOS (decisión del founder, 2026-08-11):
        //   - assessor de BANDA (DeepSeek-V4-Flash-0731, ~4s): corre CADA
        //     turno, persiste la banda para el siguiente. NO alimenta mastery.
        //   - assessor de MASTERY (Qwen3.6-35B-A3B, ~73s): corre MUESTREADO
        //     (MASTERY_ASSESSOR_SAMPLE_RATE), alimenta la cadena
        //     mastery/gamificación. La lentitud no importa: se acumula.
        // La separación la hace cumplir la allowlist deny-by-default: solo la
        // tripleta de Qwen está en BUXO_ASSESSOR_AGGREGATION_ALLOWLIST, así
        // que los veredictos de DeepSeek gobiernan la banda y NO pueden llegar
        // al mastery.
        // ⚠️ CONSECUENCIA DE PRODUCTO (visible, no resuelta en silencio): la
        // racha cuenta assessments aprobados y avanza solo cuando
        // aggregated === true. Con el mastery muestreado 1/3, la racha avanza
        // a un tercio de la velocidad — el founder lo calibra con uso real
        // (ver guía de flip).
        // ═══════════════════════════════════════════════════════════════════
        const assessorMessages: AssessorMessage[] = [
          ...tutorMessages,
          { role: "assistant", content: fullReply },
        ];

        // --- Assessor de BANDA (DeepSeek, cada turno) ---
        const bandOutcome = await runAssessor(deps.models.raw, {
          messages: assessorMessages,
          currentBand: band,
          subject: session.subjectNameSnapshot,
          task: "assessor",
          locale: localeParam,
        });
        if (bandOutcome.verdict === null) {
          console.error(
            bandOutcome.failed
              ? `[sessions] assessor de banda FALLÓ (session=${session.id} exchange=${exchange.id}): sin banda para el turno siguiente. Causa probable: saldo/rate-limit/timeout del proveedor.`
              : `[sessions] assessor de banda sin veredicto utilizable (session=${session.id} exchange=${exchange.id}): sin banda para el turno siguiente.`,
          );
        }
        if (bandOutcome.verdict) {
          const decision = applyAssessment(band, bandOutcome.verdict);
          if (decision.changed) {
            await appendBandChange(deps.db, session.id, {
              band: decision.band,
              timestamp: new Date().toISOString(),
              source: "auto",
              rationale: decision.rationale,
            });
          }
          await recordQuotaUsage(deps.db, quotaResult.quotas, "assessor", bandOutcome.costUsd);
        }

        // --- Assessor de MASTERY (Qwen, muestreado) ---
        if (deps.random() < deps.masteryAssessorSampleRate) {
          const masteryOutcome = await runAssessor(deps.models.raw, {
            messages: assessorMessages,
            currentBand: band,
            subject: session.subjectNameSnapshot,
            task: "mastery-assessor",
            locale: localeParam,
          });
          if (masteryOutcome.verdict && masteryOutcome.servedBy && masteryOutcome.promptVersion) {
            const assessment = await recordAssessment(deps.db, {
              sessionId: session.id,
              exchangeId: exchange.id,
              subjectId: session.subjectId,
              verdict: masteryOutcome.verdict,
              topicKeyRaw: masteryOutcome.topicKeyRaw,
              assessorPromptVersion: masteryOutcome.promptVersion,
              assessorModelId: masteryOutcome.servedBy.modelId,
              assessorProviderId: masteryOutcome.servedBy.providerId,
            });
            await recordQuotaUsage(deps.db, quotaResult.quotas, "assessor", masteryOutcome.costUsd);

            // B2-motor-de-dominio.md §9.4 — mastery aggregation, shadow-only
            // (F2 scope). Wrapped exactly like the rest of this block: a
            // failure here logs (the outer .catch() below) and never breaks
            // the already-streamed response.
            const masteryResult = await applyAssessmentToMastery(deps.db, {
              session,
              assessment,
              config: deps.masteryAggregationConfig,
            });

            // G2 (F3) — gamification wiring: streak + achievements.
            await applyGamificationAfterMastery(deps.db, {
              userId,
              subjectId: session.subjectId,
              topicId: session.topicId,
              assessment,
              masteryResult,
            });
          }
        }

        // Judge — sampled (D3 §7).
        if (deps.random() < deps.judgeSampleRate) {
          const judgeOutcome = await runJudge(deps.models.raw, {
            studentMessage,
            tutorReply: fullReply,
            subject: session.subjectNameSnapshot,
          });
          if (judgeOutcome.servedBy && judgeOutcome.hintOffered !== null && judgeOutcome.studentCorrect !== null) {
            await recordJudgeVerdict(deps.db, exchange.id, {
              hintOffered: judgeOutcome.hintOffered,
              studentCorrect: judgeOutcome.studentCorrect,
              judgePromptVersion: judgeOutcome.promptVersion ?? "buxo-judge-v1",
              judgeModelId: judgeOutcome.servedBy.modelId,
              judgeProviderId: judgeOutcome.servedBy.providerId,
            });
            await recordQuotaUsage(deps.db, quotaResult.quotas, "judge", judgeOutcome.costUsd);
          }
        }
      })
      .catch(async (err: unknown) => {
        // Post-stream bookkeeping must never surface as a client-visible error — the client already has its reply.
        console.error("[sessions] post-stream bookkeeping failed:", err);
        // Sin Exchange no hay turno que proteger: liberar el reclamo para que el
        // estudiante pueda reenviar el MISMO mensaje ya, en vez de esperar a que
        // el huérfano venza a los 10 minutos.
        if (!exchangePersisted && clientMessageId) {
          await releaseTurnClaim(deps.db, { sessionId: session.id, clientMessageId }).catch((releaseErr: unknown) => {
            console.error("[sessions] no se pudo liberar el reclamo huérfano:", releaseErr);
          });
        }
      });

    return response;
  });

  return app;
}

/** Band type re-export kept local for readability of this file's signatures. */
export type { Band };
