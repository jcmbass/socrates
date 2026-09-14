/**
 * Telemetría de drift — C-backend-plataforma.md §1.5 / §6.2 / §6.3.
 * "SOLO interfaces + tipos de eventos ... con un sink inyectable" per the
 * WP4 mandate. C6 §6.1's rule is load-bearing here: NO student text in any
 * event, ever — every field below is an id/enum/number/timestamp. This is
 * enforced by construction (the types simply have no string field wide
 * enough to carry prose) rather than by a runtime scrub, which is the
 * stronger guarantee.
 */
import type { Environment, ModelRef, TaskKind } from "./task";

export const FALLBACK_REASON_VALUES = [
  "network_error",
  "http_429",
  "http_5xx",
  "timeout",
  "auth_config_error",
  "structured_output_invalid",
  "unsupported_capability",
  "unknown_error",
] as const;
export type FallbackReason = (typeof FALLBACK_REASON_VALUES)[number];

/**
 * Emitted once per successfully-served call. Feeds §1.5's dashboard
 * ("Costo y latencia p50/p95 por modelo") and §6.2 ("costo por
 * intercambio").
 */
export interface ModelCallEvent {
  type: "model_call";
  task: TaskKind;
  environment: Environment;
  servedBy: ModelRef;
  /** 0 = the chain's primary candidate served the call; >0 = how many prior candidates were skipped/failed. */
  attemptIndex: number;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  /** Computed from the registry's pricePerMTokIn/Out (capabilities.ts's estimateCostUsd). null if unpriced (pending_gate); 0 if self-hosted (zero marginal cost — F3 G5). */
  costUsd: number | null;
  /** "versión de modelo servida" (§1.5) beyond modelId, when the caller tracks one (e.g. tutor's PROMPT_VERSION). */
  promptVersion: string | null;
  timestamp: string;
}

/**
 * Emitted every time the failover machinery (failover.ts) advances past a
 * candidate — either because it errored or because it was skipped for
 * lacking a required capability. Feeds §1.5's "tasa de disparo de fallback
 * por modelo" and is what the mandatory failover test asserts on.
 */
export interface FallbackEvent {
  type: "fallback";
  task: TaskKind;
  environment: Environment;
  from: ModelRef;
  /** `null` when the chain is exhausted (no further candidate to advance to). */
  to: ModelRef | null;
  reason: FallbackReason;
  attemptIndex: number;
  timestamp: string;
}

/**
 * Emitted when a model is pulled out of rotation by the drift circuit
 * breaker described in §1.5 ("se saca de rotación automáticamente ...
 * notifica al founder. Un modelo no vuelve a rotación sin revisión
 * manual"). This package defines the event shape; the statistical
 * threshold logic that decides WHEN to emit it is out of scope (it needs a
 * real metrics store/window, not a pure adapter) — a future consumer of
 * `InMemoryTelemetrySink`/a real sink implements that decision and calls
 * back into whatever disables the registry row or filters it from
 * `resolveChain`.
 */
export interface CircuitBreakEvent {
  type: "circuit_break";
  task: TaskKind;
  environment: Environment;
  model: ModelRef;
  reason: string;
  timestamp: string;
}

export type DriftEvent = ModelCallEvent | FallbackEvent | CircuitBreakEvent;

export interface TelemetrySink {
  record(event: DriftEvent): void;
}

/** Default sink — production code that hasn't wired a real sink yet must not crash or leak anywhere. */
export class NoopTelemetrySink implements TelemetrySink {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature must match TelemetrySink.record(event) for callers that hold a NoopTelemetrySink typed as the concrete class, not just the interface.
  record(event: DriftEvent): void {
    // intentionally empty
  }
}

/** Test/dev sink — the mandatory failover test asserts against `events`. */
export class InMemoryTelemetrySink implements TelemetrySink {
  public readonly events: DriftEvent[] = [];

  record(event: DriftEvent): void {
    this.events.push(event);
  }
}
