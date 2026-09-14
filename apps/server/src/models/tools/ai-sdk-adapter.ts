/**
 * Adapter from provider-agnostic temario tools to ai-sdk `tool` shape.
 *
 * This is the ONLY file in the tools layer that imports `@ai-sdk/*`, making
 * it easy to swap to a different provider SDK (or a local vLLM) by
 * introducing a sibling adapter without touching the tool definitions or
 * executors.
 *
 * Usage: build a fresh tools object per request with `createAiSdkTemarioTools(ctx)`,
 * so each tool's `execute` closure captures the authenticated caller context.
 */
import { tool } from "ai";
import type { Tool } from "ai";
import type { Db } from "../../db/client";
import type { ServerToolContext, ToolDefinition } from "./types";

export function toAiSdkTool(definition: ToolDefinition<unknown, unknown, Db>, ctx: ServerToolContext): Tool {
  return tool({
    description: definition.description,
    inputSchema: definition.parameters,
    execute: async (args: unknown) => definition.execute(ctx, args),
  });
}

export function createAiSdkTemarioTools(
  ctx: ServerToolContext,
  toolDefinitions: ReadonlyArray<ToolDefinition<unknown, unknown, Db>>,
): Record<string, Tool> {
  const result: Record<string, Tool> = {};
  for (const def of toolDefinitions) {
    result[def.name] = toAiSdkTool(def, ctx);
  }
  return result;
}
