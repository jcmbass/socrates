/**
 * StructuredAdapter — C-backend-plataforma.md §1.3's `StructuredCallParams`/
 * `StructuredAdapter`, serving `assessor`/`judge`. Wraps `generateObject`
 * from `ai` and owns what `apps/harness/app/api/assess/route.ts` and
 * `app/api/judge/route.ts` do today around the model call: trying the
 * task's chain in order (with the §1.3.1 same-model retry before
 * advancing), and forcing the registry's `structuredOutputForce`
 * providerOptions instead of trusting the AI SDK's own capability
 * detection — this IS "la estrategia alternativa documentada en la spec"
 * the WP4 mandate asks for (item 4): the fase-4 fix
 * (`docs/LECCIONES-Y-BUGS.md`, 2026-07-11) was exactly
 * `providerOptions: { anthropic: { structuredOutputMode: "outputFormat" } }`,
 * generalized here from a hardcoded literal in two route files to a value
 * read off each chain candidate's OWN registry row.
 *
 * The degrade-to-null contract from §1.3 is preserved EXACTLY: "El
 * contrato de degradación existente ... se conserva tal cual — C7 no lo
 * cambia, solo agrega intentos de fallback ANTES de llegar a esa
 * degradación final." Only once the ENTIRE chain (including the
 * non-configurable floor) is exhausted does `generateStructured` return
 * `{ ok: false, servedBy: null }` — it never throws for a model failure
 * (unlike the tutor adapter, which throws `ModelChainExhaustedError`,
 * because assessor/judge have a well-established never-block contract the
 * tutor route doesn't share — the tutor IS the product surface).
 */
import { generateObject, NoObjectGeneratedError } from "ai";
import type { FlexibleSchema } from "ai";
import type { ResolvedModelsConfig } from "../config";
import { resolveChain } from "../config";
import { runChainWithFailover } from "../failover";
import type { ModelRef, Environment } from "../task";
import type { ProviderResolver } from "../provider";
import type { TelemetrySink } from "../telemetry";
import { NoopTelemetrySink } from "../telemetry";
import { estimateCostUsd } from "../capabilities";

export type StructuredTaskKind = "assessor" | "judge" | "mastery-assessor" | "guided-items";

/** `"ai"` doesn't re-export its internal providerOptions type at the top level — extracted structurally instead of re-declaring it. */
type GenerateObjectProviderOptions = Parameters<typeof generateObject>[0]["providerOptions"];
/** Structural extract so this package stays off the DOM lib (`AbortSignal` lives there). */
type GenerateObjectAbortSignal = NonNullable<Parameters<typeof generateObject>[0]["abortSignal"]>;

export interface StructuredCallParams<T> {
  task: StructuredTaskKind;
  system: string;
  prompt: string;
  schema: FlexibleSchema<T>;
  /** O-9's "promptVersion si aplica" — forwarded verbatim into the result; @buxo/core has no per-task version constant yet (see this package's final report, "hallazgos para el arquitecto"). */
  promptVersion?: string;
  /**
   * Optional per-attempt cap forwarded to `generateObject`. Assessor/judge
   * omit it (provider default). Guided-items uses ~1800 to keep the 8-item
   * batch from rambling.
   */
  maxOutputTokens?: number;
  /**
   * Optional per-attempt abort budget. A fresh signal is created for every
   * `generateObject` call so the same-model schema retry still gets a full
   * window. Assessor/judge omit it and keep unbounded provider timeouts.
   */
  timeoutMs?: number;
  /**
   * Optional caller-owned abort. Combined with `timeoutMs` when both are set.
   * Already-aborted signals fail the attempt immediately (no hang).
   */
  abortSignal?: GenerateObjectAbortSignal;
}

function resolveAttemptAbortSignal(params: StructuredCallParams<unknown>): GenerateObjectAbortSignal | undefined {
  const timeoutMs = params.timeoutMs;
  const timeoutSignal =
    typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutAbortSignal(timeoutMs) : undefined;
  if (timeoutSignal && params.abortSignal) return combineAbortSignals(params.abortSignal, timeoutSignal);
  return timeoutSignal ?? params.abortSignal;
}

function timeoutAbortSignal(ms: number): GenerateObjectAbortSignal {
  const timeout = (
    globalThis as { AbortSignal?: { timeout?: (n: number) => GenerateObjectAbortSignal } }
  ).AbortSignal?.timeout;
  if (!timeout) {
    throw new Error("structured adapter timeoutMs requires AbortSignal.timeout");
  }
  return timeout(ms);
}

function combineAbortSignals(
  a: GenerateObjectAbortSignal,
  b: GenerateObjectAbortSignal,
): GenerateObjectAbortSignal {
  const any = (
    globalThis as { AbortSignal?: { any?: (s: GenerateObjectAbortSignal[]) => GenerateObjectAbortSignal } }
  ).AbortSignal?.any;
  if (any) return any([a, b]);
  return b;
}

export function describeStructuredFailure(lastError: unknown, chainLength: number): string {
  if (chainLength === 0) return "empty_chain";
  if (lastError instanceof Error) {
    const message = lastError.message.trim();
    return (message || lastError.name || "unknown").slice(0, 300);
  }
  if (lastError != null) return String(lastError).slice(0, 300);
  return "unknown";
}

export type StructuredCallResult<T> =
  | { ok: true; object: T; servedBy: ModelRef; promptVersion: string | null; costUsd: number | null }
  // costUsd on the failure branch too (TODOS.md "deuda F1/WP5"): an
  // exhausted chain can still have burned real tokens on the attempts that
  // failed along the way (see `NoObjectGeneratedError` handling below) —
  // "no verdict" is not the same fact as "no cost".
  | { ok: false; servedBy: null; promptVersion: null; costUsd: number | null; error: string };

export interface StructuredAdapter {
  generateStructured<T>(params: StructuredCallParams<T>): Promise<StructuredCallResult<T>>;
}

export interface CreateStructuredAdapterDeps {
  config: ResolvedModelsConfig;
  resolveProvider: ProviderResolver;
  environment: Environment;
  telemetry?: TelemetrySink;
}

export function createStructuredAdapter(deps: CreateStructuredAdapterDeps): StructuredAdapter {
  const telemetry = deps.telemetry ?? new NoopTelemetrySink();

  return {
    async generateStructured<T>(params: StructuredCallParams<T>): Promise<StructuredCallResult<T>> {
      const chain = resolveChain(deps.config, params.task);
      const callStartedAt = Date.now();

      // TODOS.md "deuda F1/WP5" (costUsd): folds the cost of EVERY
      // generateObject attempt this logical call makes — same-model
      // retries and chain advances alike — into one total, not just the
      // one that ultimately served. `null` until the first attempt with
      // known pricing contributes (mirrors estimateCostUsd's own
      // never-fabricate-a-number contract); once any attempt contributes,
      // later unpriced attempts simply add nothing further.
      let costUsd: number | null = null;
      const accumulateAttemptCost = (
        capabilities: Parameters<typeof estimateCostUsd>[0],
        usage: { inputTokens?: number; outputTokens?: number } | undefined,
      ): void => {
        const estimate = estimateCostUsd(capabilities, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0);
        if (estimate !== null) costUsd = (costUsd ?? 0) + estimate;
      };

      const outcome = await runChainWithFailover({
        chain,
        task: params.task,
        environment: deps.environment,
        telemetry,
        // §1.3.1: "fallo de validación de structured output tras 1
        // reintento en el MISMO modelo" -> advance to the next candidate.
        sameModelRetries: 1,
        // A candidate with NO structured output support at all cannot
        // serve assessor/judge no matter how many providerOptions we throw
        // at it — skip it outright rather than burning a real attempt.
        skip: (capabilities) => capabilities.structuredOutputSupport === "none",
        attempt: async ({ ref, capabilities }) => {
          const model = deps.resolveProvider(ref);
          try {
            // Explicit type args: generateObject's OUTPUT mode ("object" vs
            // "enum") is a conditional type keyed off whether the inferred
            // schema type is a string — unresolvable when T is a generic type
            // parameter rather than a concrete literal, so it's pinned to
            // "object" explicitly (every buxo structured call — assessor's 5
            // fields, judge's 2 booleans — is an object schema, never a bare
            // enum).
            const abortSignal = resolveAttemptAbortSignal(params);
            const { object, usage } = await generateObject<FlexibleSchema<T>, "object", T>({
              model,
              schema: params.schema,
              system: params.system,
              prompt: params.prompt,
              ...(params.maxOutputTokens != null ? { maxOutputTokens: params.maxOutputTokens } : {}),
              ...(abortSignal ? { abortSignal } : {}),
              // The registry's row is the single source of truth for how to
              // force correct structured-output behavior on THIS candidate —
              // never the AI SDK's own (sometimes wrong/stale) capability
              // table. `null` means no forcing is known to be needed.
              //
              // The double-cast is deliberate and narrow: ModelCapabilities.
              // structuredOutputForce is typed `Record<string, unknown> | null`
              // (matching C-backend-plataforma.md §1.2's own literal shape
              // verbatim), while the AI SDK's `providerOptions` expects its
              // internal (unexported from "ai") `Record<string, JSONObject>`
              // shape. The registry's rows are hand-authored plain JSON
              // literals (see registry.ts) — this crosses that trust boundary
              // in exactly one place instead of loosening the registry's
              // public type.
              ...(capabilities.structuredOutputForce
                ? { providerOptions: capabilities.structuredOutputForce as unknown as GenerateObjectProviderOptions }
                : {}),
            });
            accumulateAttemptCost(capabilities, usage);
            return { object, usage, capabilities };
          } catch (err) {
            // A structured-output validation failure still reaches the
            // provider and burns real tokens — `NoObjectGeneratedError`
            // (the "ai" SDK's own error for exactly this case, see
            // failover.ts's `structured_output_invalid` classification)
            // carries the `usage` from that failed attempt. Every OTHER
            // failure mode this engine retries on (network/timeout/5xx/
            // auth) never gets far enough to have usage, so nothing to add.
            if (NoObjectGeneratedError.isInstance(err) && err.usage) {
              accumulateAttemptCost(capabilities, err.usage);
            }
            throw err;
          }
        },
      });

      if (!outcome.ok) {
        return {
          ok: false,
          servedBy: null,
          promptVersion: null,
          costUsd,
          error: describeStructuredFailure(outcome.lastError, chain.length),
        };
      }

      const { object, usage, capabilities } = outcome.result;
      const servedByRef = outcome.servedBy;
      const inputTokens = usage?.inputTokens ?? null;
      const outputTokens = usage?.outputTokens ?? null;

      telemetry.record({
        type: "model_call",
        task: params.task,
        environment: deps.environment,
        servedBy: servedByRef,
        attemptIndex: outcome.attemptIndex,
        latencyMs: Date.now() - callStartedAt,
        inputTokens,
        outputTokens,
        cacheReadTokens: usage?.inputTokenDetails.cacheReadTokens ?? null,
        cacheWriteTokens: usage?.inputTokenDetails.cacheWriteTokens ?? null,
        costUsd: estimateCostUsd(capabilities, inputTokens ?? 0, outputTokens ?? 0),
        promptVersion: params.promptVersion ?? null,
        timestamp: new Date().toISOString(),
      });

      return { ok: true, object, servedBy: servedByRef, promptVersion: params.promptVersion ?? null, costUsd };
    },
  };
}
