/**
 * MilestoneAdapter — Fase P5 (DF-P05/DF-P11). A SEPARATE, opt-in execution
 * path for a Hito's "ronda de repaso", structurally mirroring
 * `./tutor.ts`'s `TutorAdapter` (same `streamText`/failover/telemetry/cache
 * plumbing — this package's whole point is that adapters don't reinvent
 * that machinery per task) but wired to `@buxo/core/milestone-prompt`
 * instead of `@buxo/core/prompts`.
 *
 * R2 compliance: this file never imports `@buxo/core/prompts` and never
 * touches `./tutor.ts` — the validated tutor prompt/adapter is completely
 * untouched by this feature. Reuses the "tutor" task's resolved chain
 * (`resolveChain(config, "tutor")`) rather than introducing a new registry
 * task key — it is still, mechanically, a call to "the tutor's model", just
 * serving a different system prompt; this avoids adding new capability rows
 * per provider for a prompt variant that hasn't been smoke-tested against a
 * real model yet (see the module's L1 note below).
 *
 * L1 (docs DEVLOG, buxo validator stage): this adapter has NEVER been
 * exercised against a real model — every test here mocks `streamText`. It
 * is wired + fake-tested, "listo para validar", NOT "validado".
 */
import { streamText, type ModelMessage } from "ai";
import { buildMilestoneSystemPrompt, MILESTONE_PROMPT_VERSION, MILESTONE_PROMPT_VERSION_LOCALE, type MilestoneScopeTopicInput } from "@buxo/core/milestone-prompt";
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

export interface MilestoneCallParams {
  messages: ModelMessage[];
  subjectName: string;
  milestoneKind: "parcial" | "examen_final";
  milestoneTitle: string;
  /** Cumulative scope, ascending order — `@buxo/domain/temario`'s `computeMilestoneScope` output. */
  topics: readonly MilestoneScopeTopicInput[];
  /** Concatenated Fuentes text for the subject (DF-P11) — see `@buxo/core/milestone-prompt`'s antialucinación handling when omitted/empty. */
  sourcesText?: string;
  /**
   * A3b/AJUSTE 4 (slice localización): opt-in preferred language of the
   * student. Only "en" may be passed — "es" is the default render and MUST
   * arrive here as `undefined` (passing "es" would append the Spanish
   * language section, breaking byte-identity for the installed base). When
   * present, `buildMilestoneSystemPrompt` appends `buildLanguageSection`
   * as the last section and `promptVersion` becomes
   * `MILESTONE_PROMPT_VERSION_LOCALE` (patrón G4).
   */
  locale?: "es" | "en";
}

/** Same AI-SDK result type `TutorAdapter` returns — see `./tutor.ts`'s module doc DEVIATION note for why this isn't a bare `ReadableStream`. */
export type MilestoneStreamTextResult = ReturnType<typeof streamText>;

export interface MilestoneStreamReply {
  result: MilestoneStreamTextResult;
  servedBy: ModelRef;
  promptVersion: string;
}

export interface MilestoneAdapter {
  streamReply(params: MilestoneCallParams): Promise<MilestoneStreamReply>;
}

export interface CreateMilestoneAdapterDeps {
  config: ResolvedModelsConfig;
  resolveProvider: ProviderResolver;
  environment: Environment;
  telemetry?: TelemetrySink;
}

const CACHE_BREAKPOINT = { anthropic: { cacheControl: { type: "ephemeral" } } };

export function createMilestoneAdapter(deps: CreateMilestoneAdapterDeps): MilestoneAdapter {
  const telemetry = deps.telemetry ?? new NoopTelemetrySink();

  return {
    async streamReply(params: MilestoneCallParams): Promise<MilestoneStreamReply> {
      // Reuses the "tutor" task's chain/capabilities — see module doc.
      const chain = resolveChain(deps.config, "tutor");
      const system = buildMilestoneSystemPrompt({
        subjectName: params.subjectName,
        milestoneKind: params.milestoneKind,
        milestoneTitle: params.milestoneTitle,
        topics: params.topics,
        sourcesText: params.sourcesText,
        ...(params.locale ? { locale: params.locale } : {}),
      });
      // Versión por-llamada (patrón G4): la corrida con locale se persiste
      // como variante, nunca como la versión default validada.
      const promptVersion = params.locale ? MILESTONE_PROMPT_VERSION_LOCALE : MILESTONE_PROMPT_VERSION;

      const outcome = await runChainWithFailover({
        chain,
        task: "tutor",
        environment: deps.environment,
        telemetry,
        sameModelRetries: 0,
        attempt: async ({ ref, capabilities }) => {
          const model = deps.resolveProvider(ref);
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
            latencyMs: Date.now() - callStartedAt,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            costUsd: estimateCostUsd(capabilities, inputTokens ?? 0, outputTokens ?? 0),
            promptVersion,
            timestamp: new Date().toISOString(),
          });
        })
        .catch(() => {
          // Telemetry must never break the response.
        });

      return { result: outcome.result, servedBy: outcome.servedBy, promptVersion };
    },
  };
}

export { formatModelRef, estimateCostUsd };
