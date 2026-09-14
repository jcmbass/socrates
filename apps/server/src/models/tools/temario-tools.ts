/**
 * Temario-builder tools — P1.
 *
 * Each tool executes a DB write inside the authenticated caller context.
 * The model only describes the intention; the server validates scope and
 * performs the mutation. Tools are provider-agnostic: see `types.ts` for
 * the contract and `ai-sdk-adapter.ts` for the ai-sdk bridge.
 */
import { z } from "zod";
import { sanitizeSubject } from "@buxo/core/subject";
import type { Db } from "../../db/client";
import type { ServerToolContext, ToolDefinition, AnyToolDefinition } from "./types";
import { eq } from "drizzle-orm";
import { findSubjectById } from "../../repositories/subjects";
import {
  createMilestoneInTemario,
  createTemario,
  createTopicInTemario,
  deleteTopicFromTemario,
  findMilestoneByTitle,
  findTemarioById,
  findTemarioBySubject,
  findTopicByTitle,
  reorderTopicsInTemario,
  setRecommendedTopic,
  updateTopicInTemario,
} from "../../repositories/temarios";
import { temas } from "../../db/schema";
import type { Hito, Tema } from "@buxo/domain/temario";

function sanitizeToolTitle(raw: string): string {
  const sanitized = sanitizeSubject(raw);
  if (sanitized.length === 0) throw new Error("tool_title_empty_after_sanitization");
  if (sanitized.length > 60) throw new Error("tool_title_too_long_after_sanitization");
  return sanitized;
}

/**
 * P2 FIX3 (2026-07-21 post-real-run REVIEW): `subjectId` comes ONLY from the
 * authenticated `ServerToolContext` (set by the route from the caller's
 * ownership-checked Subject) — it is deliberately NOT a tool `parameters`
 * field. The real Haiku run showed a model asked to supply this id either
 * hallucinates one (when absent from the prompt) or, if given it, still
 * holds a value it could in principle mutate/mis-copy — a model must never
 * be ABLE to name a different subject/materia to redirect a write. Every
 * tool below reads `ctx.subjectId` instead of an input field.
 */
async function ensureOwnedTemario(ctx: ServerToolContext) {
  const subject = await findSubjectById(ctx.db, ctx.subjectId);
  if (!subject || subject.userId !== ctx.userId) {
    throw new Error("subject_not_found_or_not_owned");
  }
  let temario = await findTemarioBySubject(ctx.db, ctx.subjectId);
  if (!temario) {
    temario = await createTemario(ctx.db, { userId: ctx.userId, subjectId: ctx.subjectId, generatedBy: "ai" });
  }
  return temario;
}

/**
 * Scoped to BOTH the caller's userId AND the context's subjectId (P2 FIX3)
 * — a tool call for topic X must not succeed just because the caller owns
 * topic X's user account; it must belong to the temario of the subject this
 * tool-calling session is actually about.
 */
async function topicAndTemario(ctx: ServerToolContext, topicId: string) {
  const [tema] = await ctx.db.select().from(temas).where(eq(temas.id, topicId)).limit(1);
  if (!tema) throw new Error("topic_not_found_or_not_owned");
  const temario = await findTemarioById(ctx.db, tema.temarioId);
  if (!temario || temario.userId !== ctx.userId || temario.subjectId !== ctx.subjectId) {
    throw new Error("topic_not_found_or_not_owned");
  }
  return temario.id;
}

export const createTopicTool: ToolDefinition<{ title: string }, Tema, Db> = {
  name: "createTopic",
  description:
    "Create a new topic in the student's temario for the current subject. " +
    "The topic is always appended at the end (the server assigns its order — " +
    "this tool takes no order/position argument). The title must be short and descriptive. " +
    "Calling this again with a title that already exists in the temario is safe: it returns " +
    "the existing topic instead of creating a duplicate.",
  parameters: z.object({
    title: z.string().min(1).max(60),
  }),
  execute: async (ctx, input) => {
    const temario = await ensureOwnedTemario(ctx);
    const sanitizedTitle = sanitizeToolTitle(input.title);
    // P2 FIX2: idempotent dedup — a repeated/duplicated tool call for a
    // title already in this temario is a no-op that returns the existing
    // row, instead of racing the model's own prior call into
    // `temas_temario_id_order_unique` (the real bug hit mid-Haiku-run).
    const existing = await findTopicByTitle(ctx.db, temario.id, sanitizedTitle);
    if (existing) return existing;
    return createTopicInTemario(ctx.db, {
      temarioId: temario.id,
      title: sanitizedTitle,
      // No `order`: always append-atomically, computed server-side inside
      // `createTopicInTemario`'s transaction. The model never dictates order.
    });
  },
};

export const createMilestoneTool: ToolDefinition<
  { title: string; kind: "parcial" | "examen_final"; coversUpToTopicTitle: string },
  Hito,
  Db
> = {
  name: "createMilestone",
  description:
    "Create a partial or final-exam milestone in the student's temario for the current subject. " +
    "coversUpToTopicTitle is the EXACT title of the LAST topic included in this milestone's cumulative " +
    "review scope — it must be the title of a topic you already created with createTopic in THIS SAME " +
    "temario (call createTopic for every topic first; create milestones only after every topic exists). " +
    "The server resolves that title to the topic's current position, so you never have to count or guess " +
    "an index — if the title doesn't match any existing topic (a typo, or a topic you haven't created yet), " +
    "the call fails with an error listing the topics that DO exist, and you can retry with the right title. " +
    "The milestone is always appended at the end (the server assigns its order). " +
    "Calling this again with a title that already exists in the temario is safe: it returns " +
    "the existing milestone instead of creating a duplicate.",
  parameters: z.object({
    title: z.string().min(1).max(60),
    kind: z.enum(["parcial", "examen_final"]),
    coversUpToTopicTitle: z.string().min(1).max(60),
  }),
  execute: async (ctx, input) => {
    const temario = await ensureOwnedTemario(ctx);
    const sanitizedTitle = sanitizeToolTitle(input.title);
    const existing = await findMilestoneByTitle(ctx.db, temario.id, sanitizedTitle);
    if (existing) return existing;

    // Bugfix (2026-07-25, post-M3-smoke REVIEW): the model NAMES the last
    // covered topic instead of guessing its numeric `order`. `createTopic`
    // deliberately never lets the model dictate order (P2 FIX2, to avoid
    // racing the append-atomically contract against the unique index), which
    // means a model asked to supply a numeric `coversUpToOrder` has to count
    // against a sequence it doesn't reliably observe — the measured real-run
    // bug ("Parcial 1: Estructura y enlaces" written with coversUpToOrder=3,
    // silently excluding "Enlace químico" at order 4) was exactly this kind
    // of miscount. Naming a topic is something a model does reliably; the
    // server resolves the title to whatever order that topic ACTUALLY holds
    // right now, which is also robust to the topic having been created in a
    // different position than the model expected.
    const sanitizedCoversTitle = sanitizeToolTitle(input.coversUpToTopicTitle);
    const coveredTopic = await findTopicByTitle(ctx.db, temario.id, sanitizedCoversTitle);
    if (!coveredTopic) {
      const existingTitles = temario.topics.map((t) => t.title);
      throw new Error(
        `milestone_covers_topic_not_found: no topic titled "${input.coversUpToTopicTitle}" exists yet in this ` +
          `temario. Call createTopic for it first, or pass the exact title of a topic you already created ` +
          `(matching is case/whitespace-insensitive). Existing topics: ` +
          (existingTitles.length > 0 ? existingTitles.map((t) => `"${t}"`).join(", ") : "(none created yet)"),
      );
    }

    return createMilestoneInTemario(ctx.db, {
      temarioId: temario.id,
      kind: input.kind,
      title: sanitizedTitle,
      coversUpToOrder: coveredTopic.order,
    });
  },
};

export const reorderTopicsTool: ToolDefinition<{ orderedIds: string[] }, Tema[], Db> = {
  name: "reorderTopics",
  description:
    "Reorder topics in the current subject's temario. orderedIds is the desired ordered list of topic ids. " +
    "Topics not listed keep their relative order after the listed ones.",
  parameters: z.object({
    orderedIds: z.array(z.string().min(1)).min(1),
  }),
  execute: async (ctx, input) => {
    const temario = await ensureOwnedTemario(ctx);
    return reorderTopicsInTemario(ctx.db, temario.id, input.orderedIds);
  },
};

export const updateTopicTool: ToolDefinition<{ topicId: string; title?: string; order?: number; recommended?: boolean }, Tema, Db> = {
  name: "updateTopic",
  description: "Update a topic's title, order, or mark it as the recommended topic.",
  parameters: z.object({
    topicId: z.string().min(1),
    title: z.string().min(1).max(60).optional(),
    order: z.number().int().min(0).optional(),
    recommended: z.boolean().optional(),
  }),
  execute: async (ctx, input) => {
    const temarioId = await topicAndTemario(ctx, input.topicId);
    if (input.recommended) {
      await setRecommendedTopic(ctx.db, temarioId, input.topicId);
    }
    return updateTopicInTemario(ctx.db, {
      id: input.topicId,
      title: input.title ? sanitizeToolTitle(input.title) : undefined,
      order: input.order,
      recommended: input.recommended,
    });
  },
};

export const deleteTopicTool: ToolDefinition<{ topicId: string }, { deleted: true }, Db> = {
  name: "deleteTopic",
  description: "Delete a topic from the temario.",
  parameters: z.object({ topicId: z.string().min(1) }),
  execute: async (ctx, input) => {
    await topicAndTemario(ctx, input.topicId);
    await deleteTopicFromTemario(ctx.db, input.topicId);
    return { deleted: true };
  },
};

export const TEMARIO_TOOLS = [
  createTopicTool,
  createMilestoneTool,
  reorderTopicsTool,
  updateTopicTool,
  deleteTopicTool,
] as const;

export type TemarioToolName = (typeof TEMARIO_TOOLS)[number]["name"];

export async function executeTemarioTool(
  ctx: ServerToolContext,
  name: string,
  args: unknown,
): Promise<unknown> {
  const tool = TEMARIO_TOOLS.find((t) => t.name === name) as AnyToolDefinition<Db> | undefined;
  if (!tool) throw new Error(`unknown_temario_tool: ${name}`);
  const parsed = tool.parameters.safeParse(args);
  if (!parsed.success) throw new Error(`invalid_tool_args: ${parsed.error.message}`);
  return tool.execute(ctx, parsed.data);
}
