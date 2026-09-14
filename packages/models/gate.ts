/**
 * Gate de validación para un modelo nuevo — C-backend-plataforma.md §1.4
 * (O-14). Per the WP4 mandate: "SOLO interfaces + tipos del resultado de
 * gate (no ejecuta gates)". `ModelGateReport` is a passive data shape a
 * future gate-runner tool (packaged separately, outside this package's
 * scope) would produce; this module also owns the ENFORCEMENT rule that
 * consumes `gateStatus` from the registry.
 */
import type { Environment, TaskKind } from "./task";
import type { GateStatus, ModelCapabilities } from "./capabilities";

export const GATE_VERDICT_VALUES = ["pass", "fail", "pending"] as const;
export type GateVerdict = (typeof GATE_VERDICT_VALUES)[number];

/** §1.4 point 1: behavioral fixture suite (reuses/generalizes packages/core/__tests__/__fixtures__/). */
export interface BehavioralFixtureResult {
  fixtureId: string;
  description: string;
  passed: boolean;
  notes: string;
}

/**
 * §1.4 point 2: structured-output reliability, assessor/judge only.
 * "N=20 llamadas ... umbral de aceptación ≥95% ... 0% de fallo tras
 * agotar el fallback intra-modelo."
 */
export interface StructuredOutputReliabilityResult {
  attempts: number;
  validOnFirstAttempt: number;
  validAfterIntraModelRetry: number;
  passThresholdFirstAttempt: number;
  requireZeroFailuresAfterRetry: boolean;
  passed: boolean;
}

/**
 * §1.4 point 3: calibration spot-check, ASSESSOR ONLY — candidate vs.
 * Sonnet baseline on the same transcript batch. "se marca como fallo del
 * gate si el candidato es sistemáticamente más laxo."
 */
export interface CalibrationSpotCheckResult {
  sampleSize: number;
  baseline: { providerId: string; modelId: string };
  /** Fraction (0-1) of cases where the candidate was more lenient than the baseline with less evidence. */
  candidateLaxerRate: number;
  laxerRateFailThreshold: number;
  passed: boolean;
  notes: string;
}

/** §1.4 point 4: real cost of the gate run itself, feeding D3 with real numbers instead of table estimates. */
export interface GateCostMeasurement {
  totalUsd: number;
  callCount: number;
  measuredAt: string;
}

/** §1.4 point 5: founder approval — 0% traffic ramp on pass, gradual ramp via feature flag (§6.4). */
export interface FounderApproval {
  approved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  /** Starts at 0 on approval — ramp is a §6.4 feature-flag concern, not decided here. */
  trafficRampPercent: number;
}

export interface ModelGateReport {
  providerId: string;
  modelId: string;
  /** A model may be gated separately per task (e.g. passes for judge, still pending for assessor). */
  task: TaskKind;
  runAt: string;
  behavioralFixtures: BehavioralFixtureResult[];
  /** `null` for `tutor` (no structured output involved) and `ingest`/`safety` unless those adopt structured output. */
  structuredOutputReliability: StructuredOutputReliabilityResult | null;
  /** `null` for every task except `assessor` (§1.4 point 3 is explicitly assessor-only). */
  calibrationSpotCheck: CalibrationSpotCheckResult | null;
  costMeasurement: GateCostMeasurement;
  founderApproval: FounderApproval;
  verdict: GateVerdict;
}

/**
 * Gate enforcement applies to EVERY TaskKind — architect's ruling on the
 * WP4 review (2026-07-14), grounded in the governing document
 * (docs/plan-app-multiplataforma/00-vision-y-arquitectura.md, principio 7
 * and its C7 section): "Todo modelo nuevo entra por gate de validación
 * (B1/O-14) antes de servir tráfico" — with NO task qualifier. The earlier
 * narrow reading (tutor/assessor only) came from the WP4 mandate's own
 * wording, but the vision doc wins: an ungated model serving `judge` in
 * prod silently decalibrates the measurement instrument, and one serving
 * `safety` is outright unacceptable — that is the layer where silent
 * degradation costs the most.
 *
 * `pending_gate` candidates are therefore blocked for ALL tasks everywhere
 * EXCEPT `dev` with `devAllowPendingGate` explicitly `true` ("sí en dev con
 * flag explícito" — read literally: blocked by default even in dev, opt-in
 * only). `staging` is deliberately NOT exempted here even though §6.5 calls
 * it "donde corren los gates de C7" — the gate SUITE itself (a separate
 * tool, out of this package's scope per the mandate) calls a candidate
 * model directly to produce the ModelGateReport; it does not need to route
 * through `resolveChain`'s task-serving path to do that.
 *
 * TODO(model-migration) RESUELTO (F3 migración DeepInfra, 2026-08-11): el
 * primer modelo real migrado (deepinfra:google/gemma-4-31B-it) pasó el gate
 * de tutor/temario-builder pero FAILÓ la calibración de assessor (laxer
 * 60.7% vs 20%) — promover la fila con `gateStatus` único habría dejado que
 * sirviera de assessor/judge en producción (la fila ahora tiene
 * `structuredOutputSupport: "native_schema"`, así que ni siquiera el skip de
 * structured.ts la frenaría). `gateStatus` acepta el valor único de hoy o un
 * mapa parcial por `TaskKind` (ver capabilities.ts `GateStatusByTask`); las
 * filas pre-migración con valor único NO cambian de comportamiento.
 */
export function gateStatusForTask(
  capabilities: Pick<ModelCapabilities, "gateStatus">,
  task: TaskKind,
): GateStatus {
  const status = capabilities.gateStatus;
  if (typeof status === "string") return status;
  // Tareas ausentes del mapa → pending_gate (deny by default): un modelo que
  // pasó el gate de una tarea NO sirve otra donde falló o no fue medido.
  return status[task] ?? "pending_gate";
}

export function isServableForTask(
  capabilities: Pick<ModelCapabilities, "gateStatus">,
  task: TaskKind,
  environment: Environment,
  devAllowPendingGate: boolean,
): boolean {
  const status = gateStatusForTask(capabilities, task);
  if (status === "validated") return true;
  return environment === "dev" && devAllowPendingGate;
}
