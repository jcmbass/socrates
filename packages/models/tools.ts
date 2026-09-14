/**
 * Provider-agnostic tool contract for the temario-builder (P2).
 *
 * This layer deliberately does NOT import `@ai-sdk/*`. Each tool is a plain
 * object with a Zod parameter schema and an executor. The server (apps/server)
 * and the model-agnostic adapter (`@buxo/models/execution/temario-builder`)
 * share this contract so the tool definitions and execution logic stay
 * swappable across provider SDKs (ai-sdk, Anthropic SDK, OpenAI SDK, local
 * vLLM) without touching either side.
 */
import type { z } from "zod";

export interface ToolContext<Db = unknown> {
  db: Db;
  userId: string;
  /**
   * The Subject this tool-calling session is scoped to (P2 FIX3, 2026-07-21
   * post-real-run review). Injected by the server from the AUTHENTICATED
   * request (route -> ToolContext), never supplied by the model as a tool
   * argument — a model must not be able to name a different subject/materia
   * to redirect a write. Tool `parameters` schemas MUST NOT include
   * `subjectId`; tool `execute` implementations read it off `ctx.subjectId`.
   */
  subjectId: string;
}

export interface ToolDefinition<Input, Output, Db = unknown> {
  name: string;
  description: string;
  parameters: z.ZodSchema<Input>;
  execute: (ctx: ToolContext<Db>, input: Input) => Promise<Output>;
}

export type AnyToolDefinition<Db = unknown> = ToolDefinition<unknown, unknown, Db>;

export interface ToolCallRequest {
  toolName: string;
  args: unknown;
}

export interface ToolCallResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}
