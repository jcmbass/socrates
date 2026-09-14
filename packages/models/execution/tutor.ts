/**
 * TutorAdapter — C-backend-plataforma.md §1.3's "Interfaces por tarea",
 * `TutorCallParams`/`TutorAdapter`. Wraps `streamText` from `ai` and owns
 * everything `apps/harness/app/api/chat/route.ts` does today except
 * request parsing/HTTP framing: building the system prompt (via
 * `@buxo/core/prompts`, G1-validated — this package never touches that
 * text, only calls it), applying prompt-caching breakpoints WHEN the
 * registry says the serving model supports them, and trying the tutor
 * chain in order via the shared failover engine (failover.ts).
 *
 * The caller (WP5's route) never names a model — it calls `streamReply`
 * with conversational params only; §1.3 item 4 of the WP4 mandate.
 *
 * DEVIATION (documented): §1.3's literal `TutorAdapter.streamReply` return
 * shape is `{ stream: ReadableStream; servedBy: ModelRef }`, with the
 * comment "stream: pasado tal cual a toTextStreamResponse()". A bare
 * `ReadableStream` has no such method — `.toTextStreamResponse()` is a
 * method on `streamText`'s OWN result object. Per the spec header itself
 * ("Los shapes son notación TypeScript, no implementación ... nada
 * necesita compilar"), this returns the full `StreamTextResult` under the
 * field name `result` instead of a bare `stream`, so the WP5 route retains
 * `.toTextStreamResponse()`/`.toUIMessageStreamResponse()`/`.usage` — the
 * same surface `apps/harness/app/api/chat/route.ts` uses today for its
 * usage-logging fire-and-forget. This preserves the spec's intent ("stream
 * pasado tal cual") while keeping the AI SDK's richer surface available,
 * consistent with "C7 envuelve el AI SDK, no lo reemplaza" (§1.1).
 */
import { streamText, type ModelMessage } from "ai";
import { getSystemPrompt, PROMPT_VERSION_LOCALE, type Band } from "@buxo/core/prompts";
import type { ResolvedModelsConfig } from "../config";
import { resolveChain } from "../config";
import { runChainWithFailover } from "../failover";
import type { ModelRef, Environment } from "../task";
import { formatModelRef } from "../task";
import type { ProviderResolver } from "../provider";
import type { TelemetrySink } from "../telemetry";
import { NoopTelemetrySink } from "../telemetry";
import { estimateCostUsd } from "../capabilities";
import { requireCapabilities } from "../registry";
import { ModelChainExhaustedError } from "../errors";

export interface TutorCallParams {
  messages: ModelMessage[];
  band: Band;
  material?: string;
  subject?: string;
  /**
   * A3b/AJUSTE 4 (slice localización): opt-in preferred language of the
   * student. Only "en" may be passed — "es" is the default render and MUST
   * arrive here as `undefined` (passing "es" would append the Spanish
   * language section, breaking byte-identity with the pre-locale render for
   * the whole installed base, who never chose a language). When present,
   * `getSystemPrompt` appends `buildLanguageSection(locale)` as the last
   * section and the returned `promptVersion` becomes the `-locale` variant
   * so calibration can distinguish the renders (patrón G4).
   */
  locale?: "es" | "en";
}

/** `streamText`'s own result type — not re-declared with explicit generics to avoid drifting from the installed `ai` version's exact signature. */
export type TutorStreamTextResult = ReturnType<typeof streamText>;

export interface TutorStreamReply {
  /** The full `streamText()` result — see the module doc's DEVIATION note for why this isn't a bare `ReadableStream`. */
  result: TutorStreamTextResult;
  /** The candidate that ACTUALLY generated the reply — O-9 procedencia, persisted by WP5 as `Exchange.tutorProviderId`/`tutorModelId`. */
  servedBy: ModelRef;
  /** O-9's "promptVersion si aplica" for the tutor side — `Exchange.tutorPromptVersion`. */
  promptVersion: string;
}

export interface TutorAdapter {
  streamReply(params: TutorCallParams): Promise<TutorStreamReply>;
}

export interface CreateTutorAdapterDeps {
  config: ResolvedModelsConfig;
  resolveProvider: ProviderResolver;
  environment: Environment;
  telemetry?: TelemetrySink;
  /**
   * Beta externa (BE2 decision, 2026-07-18): versión del prompt del tutor.
   * "buxo-socratic-v3" (default) usa el prompt base. "buxo-socratic-v4"
   * activa las reglas endurecidas (hardened) que pasaron el gate O-14.
   */
  promptVersion?: "buxo-socratic-v3" | "buxo-socratic-v4";
}

const CACHE_BREAKPOINT = { anthropic: { cacheControl: { type: "ephemeral" } } };

export function createTutorAdapter(deps: CreateTutorAdapterDeps): TutorAdapter {
  const telemetry = deps.telemetry ?? new NoopTelemetrySink();
  const promptVersion = deps.promptVersion ?? "buxo-socratic-v3";
  const isHardened = promptVersion === "buxo-socratic-v4";

  return {
    async streamReply(params: TutorCallParams): Promise<TutorStreamReply> {
      const chain = resolveChain(deps.config, "tutor");
      const system = getSystemPrompt(params.band, params.material, params.subject, {
        hardened: isHardened || undefined,
        locale: params.locale,
      });
      // Versión por-llamada (patrón G4): una corrida con locale es una
      // variante distinta del default validado y su versión lo declara. Para
      // v3 esto es exactamente PROMPT_VERSION_LOCALE
      // ("buxo-socratic-v3-locale"); para v4 hardened deriva el par
      // "buxo-socratic-v4-locale" con la misma regla (no hay const en core
      // para ese par aún — declarado en el reporte del slice).
      const callPromptVersion = params.locale
        ? isHardened
          ? `${promptVersion}-locale`
          : PROMPT_VERSION_LOCALE
        : promptVersion;

      const outcome = await runChainWithFailover({
        chain,
        task: "tutor",
        environment: deps.environment,
        telemetry,
        // Streaming calls have no same-model retry in §1.3.1 (only assessor/
        // judge structured-output failures get one) — a failed/errored
        // stream advances straight to the next chain candidate.
        sameModelRetries: 0,
        attempt: async ({ ref, capabilities }) => {
          const model = deps.resolveProvider(ref);

          // §2.6: "el caché es dinero gratis si está disponible, nunca un
          // requisito" — only attach cacheControl providerOptions when the
          // registry says THIS candidate supports Anthropic-style explicit
          // breakpoints; every other provider gets plain messages/system.
          const useExplicitCache = capabilities.promptCaching === "explicit_breakpoints";
          const messages: ModelMessage[] = useExplicitCache
            ? params.messages.map((message, i) =>
                i === params.messages.length - 1
                  ? { ...message, providerOptions: CACHE_BREAKPOINT }
                  : message,
              )
            : params.messages;

          return Promise.resolve(
            streamText({
              model,
              system: useExplicitCache
                ? { role: "system", content: system, providerOptions: CACHE_BREAKPOINT }
                : system,
              messages,
            }),
          );
        },
      });

      if (!outcome.ok) {
        throw new ModelChainExhaustedError("tutor", [...chain], outcome.lastError);
      }

      // Fire-and-forget usage/cost telemetry — mirrors
      // apps/harness/app/api/chat/route.ts's existing pattern, generalized
      // to the registry's per-row pricing instead of a hardcoded table.
      // Never blocks/breaks the returned stream.
      const servedByRef = outcome.servedBy;
      const callStartedAt = Date.now();
      void Promise.resolve(outcome.result.usage)
        .then((usage) => {
          if (!usage) return;
          const capabilities = requireCapabilities("tutor", servedByRef);
          const inputTokens = usage.inputTokens ?? null;
          const outputTokens = usage.outputTokens ?? null;
          const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? null;
          const cacheWriteTokens = usage.inputTokenDetails.cacheWriteTokens ?? null;
          telemetry.record({
            type: "model_call",
            task: "tutor",
            environment: deps.environment,
            servedBy: servedByRef,
            attemptIndex: outcome.attemptIndex,
            // Approximate: measured from adapter call to usage-promise resolution
            // (which resolves once the stream finishes) — not first-byte latency.
            // TODO(WP5): thread a real time-to-first-byte through streamText's
            // onChunk callback if that finer-grained metric is needed.
            latencyMs: Date.now() - callStartedAt,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            costUsd: estimateCostUsd(capabilities, inputTokens ?? 0, outputTokens ?? 0),
            promptVersion: callPromptVersion,
            timestamp: new Date().toISOString(),
          });
        })
        .catch(() => {
          // Telemetry must never break the response — same contract as the route it replaces.
        });

      return { result: outcome.result, servedBy: outcome.servedBy, promptVersion: callPromptVersion };
    },
  };
}

// Re-exported for WP5 callers that want to format a ModelRef for logging without importing task.ts directly.
export { formatModelRef, estimateCostUsd };
