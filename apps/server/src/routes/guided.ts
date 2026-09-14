/**
 * Guided session routes — topic_items ensure/list + answer/complete XP (D1-b/c).
 */
import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";
import { findSubjectById } from "../repositories/subjects";
import { findTemarioBySubject } from "../repositories/temarios";
import { ensureTopicItems, findTopicItems, GuidedItemsQuotaExceededError } from "../repositories/topic-items";
import { listFuentesBySubject } from "../repositories/fuentes";
import { buildFuentesSourceText } from "../materials/session-context";
import { createXpEvent, hasGuidedSessionComplete } from "../repositories/xp";
import { createQuotaRejection } from "../repositories/quota-rejections";
import { findUserById } from "../repositories/users";
import { temas } from "../db/schema";
import {
  type GuidedItem,
  stripGuidedItemAnswers,
} from "@buxo/domain/guided-item";
import { guidedItemXp, guidedSessionXp } from "@buxo/domain/xp";

const AnswerBodySchema = z.object({
  selected: z.union([z.string(), z.number()]),
  attempt: z.union([z.literal(1), z.literal(2)]),
  responseMs: z.number().int().min(0),
});

async function loadSubjectForUser(db: AppDeps["db"], userId: string, subjectId: string) {
  const subject = await findSubjectById(db, subjectId);
  if (!subject || subject.userId !== userId) return null;
  return subject;
}

async function loadTopicInSubject(db: AppDeps["db"], subjectId: string, topicId: string) {
  const [tema] = await db.select().from(temas).where(eq(temas.id, topicId)).limit(1);
  if (!tema) return null;
  const temario = await findTemarioBySubject(db, subjectId);
  if (!temario || temario.id !== tema.temarioId) return null;
  return tema;
}

async function ensureGuidedItems(deps: AppDeps, input: {
  userId: string;
  subjectId: string;
  topicId: string;
  title: string;
  unitLabel?: string | null;
}) {
  const user = await findUserById(deps.db, input.userId);
  if (!user) throw new Error("ensureGuidedItems: user missing");
  const fuentes = await listFuentesBySubject(deps.db, input.userId, input.subjectId);
  const sources = buildFuentesSourceText(fuentes, { subjectId: input.subjectId, kind: "topic" });
  return ensureTopicItems(deps.db, {
    ...input,
    sourcesText: sources?.text,
    requireSources: deps.env.BUXO_GUIDED_REQUIRE_SOURCES,
    structuredAdapter: deps.models.structuredAdapter,
    now: deps.now(),
    quota: { accountKind: user.accountKind, config: deps.quotaConfig },
  });
}

function isAnswerCorrect(item: GuidedItem, selected: string | number): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  if (typeof item.answer === "number") {
    if (typeof selected === "number") return selected === item.answer;
    const parsed = Number(selected);
    if (Number.isInteger(parsed) && !Number.isNaN(parsed) && parsed === item.answer) return true;
    // Mobile sends option label text; generator stores 0-based index.
    const expected = item.options[item.answer];
    return expected != null && norm(String(selected)) === norm(expected);
  }
  return norm(String(selected)) === norm(item.answer);
}

export function createGuidedRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.post("/:subjectId/topics/:topicId/items:ensure", async (c) => {
    const userId = c.get("userId");
    const subjectId = c.req.param("subjectId");
    const topicId = c.req.param("topicId");

    const subject = await loadSubjectForUser(deps.db, userId, subjectId);
    if (!subject) return errorResponse(c, "not_found", "Subject not found");

    const tema = await loadTopicInSubject(deps.db, subjectId, topicId);
    if (!tema) return errorResponse(c, "not_found", "Topic not found");

    try {
      const result = await ensureGuidedItems(deps, {
        userId,
        subjectId,
        topicId,
        title: tema.title,
        unitLabel: tema.unitLabel,
      });

      return c.json({
        items: result.payload ? stripGuidedItemAnswers(result.payload.items) : [],
        degraded: result.degraded,
        degradedReason: result.degradedReason,
        grounding: result.grounding,
        generatorVersion: result.generatorVersion,
      });
    } catch (err) {
      if (err instanceof GuidedItemsQuotaExceededError) {
        await createQuotaRejection(deps.db, { userId, reason: "cost_cap", surface: "guided_items" });
        return errorResponse(c, "quota_exceeded", `Guided items generation quota exceeded (${err.reason})`);
      }
      throw err;
    }
  });

  app.get("/:subjectId/topics/:topicId/items", async (c) => {
    const userId = c.get("userId");
    const subjectId = c.req.param("subjectId");
    const topicId = c.req.param("topicId");

    const subject = await loadSubjectForUser(deps.db, userId, subjectId);
    if (!subject) return errorResponse(c, "not_found", "Subject not found");

    const tema = await loadTopicInSubject(deps.db, subjectId, topicId);
    if (!tema) return errorResponse(c, "not_found", "Topic not found");

    const record = await findTopicItems(deps.db, subjectId, topicId);
    if (!record) return errorResponse(c, "not_found", "Topic items not found");

    return c.json({
      items: stripGuidedItemAnswers(record.payload.items),
      degraded: false,
      degradedReason: null,
      grounding: record.payload.grounding,
      generatorVersion: record.payload.generatorVersion,
    });
  });

  app.post("/:subjectId/topics/:topicId/items/:itemId/answer", async (c) => {
    const userId = c.get("userId");
    const subjectId = c.req.param("subjectId");
    const topicId = c.req.param("topicId");
    const itemId = c.req.param("itemId");

    const parsed = AnswerBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);

    const subject = await loadSubjectForUser(deps.db, userId, subjectId);
    if (!subject) return errorResponse(c, "not_found", "Subject not found");

    const tema = await loadTopicInSubject(deps.db, subjectId, topicId);
    if (!tema) return errorResponse(c, "not_found", "Topic not found");

    const record = await findTopicItems(deps.db, subjectId, topicId);
    if (!record) return errorResponse(c, "not_found", "Topic items not found");

    const item = record.payload.items.find((i) => i.id === itemId);
    if (!item) return errorResponse(c, "not_found", "Item not found");

    const correct = isAnswerCorrect(item, parsed.data.selected);
    let xpDelta = 0;

    if (correct) {
      const { delta, reason } = guidedItemXp(parsed.data.attempt);
      xpDelta = delta;
      await createXpEvent(deps.db, {
        userId,
        subjectId,
        topicId,
        delta,
        reason,
        assessmentRef: null,
        itemId: item.id,
        itemType: item.type,
        difficulty: item.difficulty,
        correct: true,
        responseMs: parsed.data.responseMs,
        attempt: parsed.data.attempt,
      });
    }

    return c.json({
      correct,
      explanation: item.explanation,
      xpDelta,
    });
  });

  app.post("/:subjectId/topics/:topicId/guided:complete", async (c) => {
    const userId = c.get("userId");
    const subjectId = c.req.param("subjectId");
    const topicId = c.req.param("topicId");

    const subject = await loadSubjectForUser(deps.db, userId, subjectId);
    if (!subject) return errorResponse(c, "not_found", "Subject not found");

    const tema = await loadTopicInSubject(deps.db, subjectId, topicId);
    if (!tema) return errorResponse(c, "not_found", "Topic not found");

    const already = await hasGuidedSessionComplete(deps.db, userId, topicId);
    if (already) {
      return c.json({ xpDelta: 0 });
    }

    const { delta, reason } = guidedSessionXp();
    await createXpEvent(deps.db, {
      userId,
      subjectId,
      topicId,
      delta,
      reason,
      assessmentRef: null,
    });

    return c.json({ xpDelta: delta });
  });

  return app;
}
