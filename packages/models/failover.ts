/**
 * Fallback/failover engine — C-backend-plataforma.md §1.3.1. Shared by both
 * execution wrappers (execution/tutor.ts, execution/structured.ts) so the
 * "what triggers fallback" policy is defined exactly once.
 *
 * §1.3.1 triggers (advance to the next chain candidate): auth/config error,
 * HTTP 429/5xx, timeout, structured-output validation failure after 1
 * retry on the SAME model. §1.3.1 explicitly does NOT trigger fallback for
 * a validly-shaped but badly-calibrated response — that's a quality/drift
 * concern (telemetry.ts), not an availability concern, and this module
 * never sees it (a valid response is just returned, full stop).
 *
 * `ModelsConfigError` is NEVER caught/masked here (§0 decision 1's fail-loud
 * rule extends into the runtime path too) — though in practice it shouldn't
 * be thrown mid-chain at all, since `loadModelsConfig` already validated
 * every configured entry exists in the registry before this ever runs.
 */
import { requireCapabilities } from "./registry";
import type { ModelCapabilities } from "./capabilities";
import type { Environment, ModelRef, TaskKind } from "./task";
import type { FallbackReason, TelemetrySink } from "./telemetry";
import { ModelsConfigError } from "./errors";

export interface ChainAttemptContext {
  ref: ModelRef;
  capabilities: ModelCapabilities;
  attemptIndex: number;
}

export type ChainOutcome<T> =
  | { ok: true; result: T; servedBy: ModelRef; attemptIndex: number }
  | { ok: false; lastError: unknown };

export type ErrorClassification = FallbackReason | "non_retryable";

/**
 * Maps a thrown error to a fallback reason. Deliberately conservative in
 * one direction: an error this classifier doesn't recognize still advances
 * the chain (as "unknown_error", visibly recorded in telemetry) rather than
 * propagating as a hard failure — availability (never blocking the
 * tutor/assessor/judge, an existing behavioral contract in
 * apps/harness/app/api/{assess,judge}/route.ts) wins over narrowly matching
 * §1.3.1's trigger list. The one case that's never treated as retryable is
 * `ModelsConfigError` — a config error must surface, not be silently eaten
 * by a fallback loop.
 */
export function defaultClassifyError(err: unknown): ErrorClassification {
  if (err instanceof ModelsConfigError) return "non_retryable";
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  const message = err instanceof Error ? err.message : String(err);
  if (/\b429\b|rate.?limit/i.test(message)) return "http_429";
  if (/\b5\d{2}\b|internal server error|bad gateway|service unavailable/i.test(message)) return "http_5xx";
  if (/timeout|timed out|ETIMEDOUT|aborted/i.test(message)) return "timeout";
  if (/unauthorized|forbidden|\b401\b|\b403\b|api.?key/i.test(message)) return "auth_config_error";
  if (/network|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(message)) return "network_error";
  if (/schema|NoObjectGeneratedError|could not parse|structured/i.test(message)) return "structured_output_invalid";
  return "unknown_error";
}

export interface RunChainWithFailoverParams<T> {
  chain: readonly ModelRef[];
  task: TaskKind;
  environment: Environment;
  telemetry: TelemetrySink;
  /** §1.3.1: "1 reintento en el MISMO modelo" for structured tasks; 0 for tutor (streaming has no same-model retry in the spec). */
  sameModelRetries: number;
  /** Skip a candidate entirely (e.g. it lacks structured output support at all) without attempting it. */
  skip?: (capabilities: ModelCapabilities) => boolean;
  attempt: (ctx: ChainAttemptContext) => Promise<T>;
  classifyError?: (err: unknown) => ErrorClassification;
  now?: () => string;
}

export async function runChainWithFailover<T>(params: RunChainWithFailoverParams<T>): Promise<ChainOutcome<T>> {
  const classifyError = params.classifyError ?? defaultClassifyError;
  const nowIso = params.now ?? (() => new Date().toISOString());
  let lastError: unknown;

  for (let i = 0; i < params.chain.length; i++) {
    const ref = params.chain[i];
    const capabilities = requireCapabilities(params.task, ref);

    if (params.skip?.(capabilities)) {
      const to = params.chain[i + 1] ?? null;
      params.telemetry.record({
        type: "fallback",
        task: params.task,
        environment: params.environment,
        from: ref,
        to,
        reason: "unsupported_capability",
        attemptIndex: i,
        timestamp: nowIso(),
      });
      continue;
    }

    for (let retry = 0; retry <= params.sameModelRetries; retry++) {
      try {
        const result = await params.attempt({ ref, capabilities, attemptIndex: i });
        return { ok: true, result, servedBy: ref, attemptIndex: i };
      } catch (err) {
        lastError = err;
        const classification = classifyError(err);
        if (classification === "non_retryable") throw err;
        if (retry < params.sameModelRetries) continue;

        const to = params.chain[i + 1] ?? null;
        params.telemetry.record({
          type: "fallback",
          task: params.task,
          environment: params.environment,
          from: ref,
          to,
          reason: classification,
          attemptIndex: i,
          timestamp: nowIso(),
        });
      }
    }
  }

  return { ok: false, lastError };
}
