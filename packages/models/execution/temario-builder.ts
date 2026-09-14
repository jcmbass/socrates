/**
 * Temario-builder adapter — P2.
 *
 * Construye un temario a partir del texto de un programa usando un loop de
 * tool-calling provider-agnostic. Recibe tool definitions genéricas (ver
 * `@buxo/models/tools`) y un contexto auth-scoped; internamente las convierte
 * a ai-sdk `Tool` y ejecuta el loop manual (ai-sdk 7.0.4 no expone `maxSteps`
 * en `generateText`, así que el loop se controla aquí).
 *
 * Fail-loud: cualquier proveedor sin `toolUse: true` en el registry se salta.
 * Si la cadena completa carece de soporte de tools, o si `generateText` lanza
 * un error explícito de "no soporta tool-calling", se propaga como
 * `ModelChainExhaustedError` — nunca devuelve un temario vacío en silencio.
 */
import { generateText, tool } from "ai";
import type { Tool, ModelMessage, ToolCallPart, ToolResultPart } from "ai";
import type { ResolvedModelsConfig } from "../config";
import { resolveChain } from "../config";
import { runChainWithFailover, defaultClassifyError } from "../failover";
import type { ModelRef, Environment } from "../task";
import type { ProviderResolver } from "../provider";
import type { TelemetrySink } from "../telemetry";
import { NoopTelemetrySink } from "../telemetry";
import { estimateCostUsd } from "../capabilities";
import { ModelChainExhaustedError } from "../errors";
import type { AnyToolDefinition, ToolContext } from "../tools";

export interface TemarioBuilderCallParams {
  system: string;
  prompt: string;
  tools: ReadonlyArray<AnyToolDefinition<unknown>>;
  toolContext: ToolContext<unknown>;
  /**
   * Subject identifier — used by fake adapters to drive tool calls
   * deterministically (`BUXO_FAKE_MODELS`) and to compute `servedBy`'s
   * capabilities lookup. P2 FIX3 (2026-07-21): NOT forwarded to the model or
   * to any tool argument — `toolContext.subjectId` (the authenticated
   * caller's own value) is what tool executors actually read.
   */
  subjectId: string;
  maxSteps?: number;
  promptVersion: string;
}

export interface TemarioBuilderResult {
  text: string;
  servedBy: ModelRef;
  promptVersion: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  costUsd: number | null;
}

export interface TemarioBuilderAdapter {
  generateTemario(params: TemarioBuilderCallParams): Promise<TemarioBuilderResult>;
}

export interface CreateTemarioBuilderAdapterDeps {
  config: ResolvedModelsConfig;
  resolveProvider: ProviderResolver;
  environment: Environment;
  telemetry?: TelemetrySink;
}

const DEFAULT_MAX_STEPS = 10;

function toAiSdkTool(definition: AnyToolDefinition<unknown>, ctx: ToolContext<unknown>): Tool {
  return tool({
    description: definition.description,
    inputSchema: definition.parameters,
    execute: async (args: unknown) => definition.execute(ctx, args),
  });
}

function buildAiSdkTools(
  definitions: ReadonlyArray<AnyToolDefinition<unknown>>,
  ctx: ToolContext<unknown>,
): Record<string, Tool> {
  const result: Record<string, Tool> = {};
  for (const def of definitions) {
    result[def.name] = toAiSdkTool(def, ctx);
  }
  return result;
}

function isToolUseUnsupportedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /tool.?use|tool.?calling|does not support|unsupported/i.test(message);
}

export function createTemarioBuilderAdapter(deps: CreateTemarioBuilderAdapterDeps): TemarioBuilderAdapter {
  const telemetry = deps.telemetry ?? new NoopTelemetrySink();

  return {
    async generateTemario(params: TemarioBuilderCallParams): Promise<TemarioBuilderResult> {
      const chain = resolveChain(deps.config, "temario-builder");
      const maxSteps = params.maxSteps ?? DEFAULT_MAX_STEPS;
      const callStartedAt = Date.now();

      const outcome = await runChainWithFailover({
        chain,
        task: "temario-builder",
        environment: deps.environment,
        telemetry,
        sameModelRetries: 0,
        skip: (capabilities) => !capabilities.toolUse,
        attempt: async ({ ref, capabilities }) => {
          const model = deps.resolveProvider(ref);
          const tools = buildAiSdkTools(params.tools, params.toolContext);
          const messages: ModelMessage[] = [{ role: "user", content: params.prompt }];
          let totalInputTokens = 0;
          let totalOutputTokens = 0;

          for (let step = 0; step < maxSteps; step++) {
            const result = await generateText({
              model,
              system: params.system,
              messages,
              tools,
            });

            totalInputTokens += result.usage?.inputTokens ?? 0;
            totalOutputTokens += result.usage?.outputTokens ?? 0;

            const calls = result.toolCalls;
            if (!calls || calls.length === 0) {
              return {
                text: result.text,
                usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
                capabilities,
              };
            }

            const toolCallParts: ToolCallPart[] = calls.map((call) => ({
              type: "tool-call",
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              input: call.input,
            }));
            messages.push({ role: "assistant", content: toolCallParts });

            for (const call of calls) {
              const matched = tools[call.toolName];
              if (!matched || typeof matched.execute !== "function") {
                throw new Error(`temario-builder: tool ${call.toolName} is not executable`);
              }
              let output: Awaited<ReturnType<NonNullable<typeof matched.execute>>>;
              try {
                output = await matched.execute(call.input, {
                  toolCallId: call.toolCallId,
                  messages,
                  context: params.toolContext,
                });
              } catch (toolErr) {
                // Diagnostic: a silent tool failure here is otherwise
                // indistinguishable from a provider error once it propagates
                // through runChainWithFailover's classifyError — log the tool
                // name/input so a failed attempt is debuggable from server
                // logs alone (2026-07-21 P2 real-API validation gap).
                console.error(
                  `[temario-builder] tool "${call.toolName}" failed`,
                  JSON.stringify(call.input),
                  toolErr instanceof Error ? toolErr.message : toolErr,
                );
                throw toolErr;
              }
              // ai 7.0.4 requires ToolResultPart.output to be a discriminated
              // ToolResultOutput ({type:"json", value:...}), NOT the raw tool
              // return value. Passing the bare DB row typechecks (loose type)
              // but fails ai's Zod validation on the NEXT generateText turn —
              // this was P2 real-API bug #6 (2026-07-21), invisible to fake
              // adapters that never exercise ai's real message validation.
              // The JSON round-trip also guarantees a plain JSONValue (Drizzle
              // rows can carry Date/undefined that JSONValue rejects).
              const resultPart: ToolResultPart = {
                type: "tool-result",
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                output: { type: "json", value: JSON.parse(JSON.stringify(output)) },
              };
              messages.push({ role: "tool", content: [resultPart] });
            }
          }

          throw new Error(`temario-builder: exceeded maxSteps (${maxSteps}) without finishing`);
        },
        classifyError: (err) => {
          // Un proveedor que no soporta tool-calling debe fallar fuerte
          // inmediatamente, sin intentar el siguiente candidato con un error
          // genérico. El `skip` de arriba ya evita candidatos sin toolUse, pero
          // si ai-sdk lanza un error explícito de unsupported, no lo enmascaramos.
          if (isToolUseUnsupportedError(err)) return "non_retryable";
          return defaultClassifyError(err);
        },
      });

      if (!outcome.ok) {
        throw new ModelChainExhaustedError("temario-builder", [...chain], outcome.lastError);
      }

      const { text, usage, capabilities } = outcome.result;
      const servedByRef = outcome.servedBy;
      const inputTokens = usage?.inputTokens ?? null;
      const outputTokens = usage?.outputTokens ?? null;
      const costUsd = estimateCostUsd(capabilities, inputTokens ?? 0, outputTokens ?? 0);

      telemetry.record({
        type: "model_call",
        task: "temario-builder",
        environment: deps.environment,
        servedBy: servedByRef,
        attemptIndex: outcome.attemptIndex,
        latencyMs: Date.now() - callStartedAt,
        inputTokens,
        outputTokens,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        costUsd,
        promptVersion: params.promptVersion,
        timestamp: new Date().toISOString(),
      });

      return {
        text,
        servedBy: servedByRef,
        promptVersion: params.promptVersion,
        usage: inputTokens !== null && outputTokens !== null ? { inputTokens, outputTokens } : null,
        costUsd,
      };
    },
  };
}
