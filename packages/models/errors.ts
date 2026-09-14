/**
 * Error taxonomy for @buxo/models (C7).
 *
 * `ModelsConfigError` is the fail-loud primitive at the heart of C7
 * (C-backend-plataforma.md §0 decision 1, §1.2 "Invariante de arranque"):
 * thrown at CONFIG LOAD TIME, never at call time, and never caught by the
 * runtime failover machinery (packages/models/failover.ts) — a config
 * error is a deployment error, not a transient fault, and must never be
 * masked by degrading to the next chain candidate. See
 * `docs/LECCIONES-Y-BUGS.md` 2026-07-11: the whole point of this package is
 * to invert that failure mode (silent capability assumption), not
 * reintroduce a new flavor of it by swallowing config errors in a retry loop.
 */
import type { ModelRef, TaskKind } from "./task";
import { formatModelRef } from "./task";

export class ModelsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelsConfigError";
  }
}

/**
 * Thrown by `resolveChain(task, env)`/`loadModelsConfig` when a configured
 * (or env-var-parsed) chain entry has no row in the capabilities registry
 * (packages/models/registry.ts). The offending pair is embedded in the
 * message on purpose — this is the string a founder reads at deploy time,
 * so it must be actionable without opening a debugger.
 */
export function unregisteredModelError(task: TaskKind, ref: ModelRef): ModelsConfigError {
  return new ModelsConfigError(
    `@buxo/models config error: task "${task}" references (providerId=${JSON.stringify(ref.providerId)}, ` +
      `modelId=${JSON.stringify(ref.modelId)}) — "${formatModelRef(ref)}" has no row in the @buxo/models ` +
      `capabilities registry (packages/models/registry.ts). Fail-loud by design ` +
      `(C-backend-plataforma.md §1.2): add a ModelCapabilities row for this pair after reading the ` +
      `provider's docs and running the O-14 gate, or fix the config/env var if this was a typo.`,
  );
}

/** Thrown when every candidate in a task's chain has been attempted and failed. */
export class ModelChainExhaustedError extends Error {
  public readonly task: TaskKind;
  public readonly chain: ModelRef[];

  constructor(task: TaskKind, chain: ModelRef[], lastError?: unknown) {
    const chainStr = chain.map(formatModelRef).join(" -> ");
    const lastErrStr =
      lastError instanceof Error ? lastError.message : lastError !== undefined ? String(lastError) : "unknown";
    super(
      `@buxo/models: all ${chain.length} candidate(s) in the "${task}" chain failed: ${chainStr}. ` +
        `Last error: ${lastErrStr}`,
    );
    this.name = "ModelChainExhaustedError";
    this.task = task;
    this.chain = chain;
  }
}
