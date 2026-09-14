/**
 * Provider-agnostic tool contract for the temario-builder (P1/P2).
 *
 * Re-exported from `@buxo/models/tools` so the server and the model-agnostic
 * adapter share the same contract. The tools layer deliberately does NOT
 * import `@ai-sdk/*` here; see `ai-sdk-adapter.ts` for the ai-sdk bridge.
 */
import type { Db } from "../../db/client";
import type {
  AnyToolDefinition as AnyToolDefinitionGeneric,
  ToolCallRequest,
  ToolCallResult,
  ToolContext as ToolContextGeneric,
  ToolDefinition as ToolDefinitionGeneric,
} from "@buxo/models/tools";

export type { ToolCallRequest, ToolCallResult };
export type ToolDefinition<Input, Output, DbType = unknown> = ToolDefinitionGeneric<Input, Output, DbType>;
export type ToolContext<DbType = unknown> = ToolContextGeneric<DbType>;
export type AnyToolDefinition<DbType = unknown> = AnyToolDefinitionGeneric<DbType>;

/**
 * Server-side concrete type for the tool context — same shape as the generic
 * `ToolContext<Db>` with the server's `Db` type pinned.
 */
export type ServerToolContext = ToolContext<Db>;
