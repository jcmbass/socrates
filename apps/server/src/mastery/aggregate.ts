/**
 * B2-motor-de-dominio.md §1/§3.2/§5/§7.2/§9.4 — the thin C2-side caller of
 * the PURE reducers in `@buxo/domain/mastery-engine` (`aggregate`,
 * `applyDecay`, `foldMasteryLevel`), run inside `routes/sessions.ts`'s
 * post-stream block right after `recordAssessment` (§9.4: "disparada tras
 * cada AssessmentStore.append"). Everything HERE does I/O (db reads/writes,
 * env-derived config) — the actual business rules never get reimplemented
 * in this file, only invoked with the right arguments.
 *
 * F2 scope (B2 §11): shadow-only. `visibilityMode` defaults to `"shadow"`
 * (env.ts's `MASTERY_VISIBILITY_MODE`) and the tripleta allowlist defaults
 * to deny-all (PB2: flip de allow-all a deny-all). En **dev** la agregación
 * se detiene hasta que el founder setee `BUXO_ASSESSOR_AGGREGATION_ALLOWLIST`
 * (p.ej. un entry comodín "proveedor/modelo/version" para allow-all).
 */
import type { Db } from "../db/client";
import type { StudySession } from "@buxo/domain/study-session";
import type { Assessment } from "@buxo/domain/assessment";
import type { MasteryLevel, MasteryVisibility } from "@buxo/domain/mastery";
import {
  aggregate,
  applyDecay,
  foldMasteryLevel,
  B2_AGGREGATION_VERSION,
  DEFAULT_MASTERY_AGGREGATION_CONFIG,
  type MasteryAggregationConfig,
} from "@buxo/domain/mastery-engine";
import { SUBJECT_ROLLUP_TOPIC_KEY } from "@buxo/domain/sentinels";
import { assertMasteryHistoryEntryAssessmentsScopedToSubject } from "@buxo/domain/invariants";
import { findMasteryState, listAllMasteryStates, writeMasteryState } from "../repositories/mastery";
import { listAssessmentsBySubject } from "../repositories/assessments";

// ---------------------------------------------------------------------------
// Tripleta allowlist — B2 §7.2
// ---------------------------------------------------------------------------

export interface AssessorTripleta {
  providerId: string;
  modelId: string;
  promptVersion: string;
}

/** Empty array = deny-all (PB2: unset/vacío ya no es allow-all — ver docblock de env.ts). */
export type AssessorAggregationAllowlist = readonly string[];

/**
 * Fail-loud (same discipline as `loadModelsConfig`'s boot-time parsing) — a
 * MALFORMED allowlist must crash boot, never silently degrade to allow-all
 * or deny-all. An UNSET/empty value is not malformed — that's the
 * documented deny-by-default posture (PB2: flip de allow-all a deny-all).
 * En **dev** la agregación se detiene hasta que el founder setee
 * `BUXO_ASSESSOR_AGGREGATION_ALLOWLIST` (p.ej. un entry comodín
 * "proveedor/modelo/version" para allow-all o uno específico para una tripleta).
 */
export function parseAssessorAggregationAllowlist(raw: string | undefined): AssessorAggregationAllowlist {
  if (raw === undefined || raw.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `BUXO_ASSESSOR_AGGREGATION_ALLOWLIST must be valid JSON (got: ${raw}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(parsed) || !parsed.every((v): v is string => typeof v === "string")) {
    throw new Error(
      'BUXO_ASSESSOR_AGGREGATION_ALLOWLIST must be a JSON array of strings ("providerId/modelId/promptVersion", "*" wildcard per field)',
    );
  }
  return parsed;
}

/**
 * Empty array denies everything (PB2: deny-by-default). Each entry is
 * "providerId/modelId/promptVersion" with "*" as a per-field wildcard, ANY
 * match allows.
 *
 * 🚨 FIX 2026-08-11 (migración DeepInfra, bug cazado por el arquitecto): el
 * parser viejo hacía `split("/")` y exigía exactamente 3 partes. Los ids de
 * DeepInfra llevan slash DENTRO del modelo (`Qwen/Qwen3.6-35B-A3B`,
 * `deepseek-ai/DeepSeek-V4-Flash-0731`), así que la tripleta
 * `deepinfra/Qwen/Qwen3.6-35B-A3B/buxo-assessor-v3` daba 4 partes → DENEGADA
 * EN SILENCIO (deny-by-default: sin error, el mastery no acumula, las rachas
 * no suben, y el panel se ve "funcionando"). Se parsea por los extremos: el
 * PRIMER segmento es el proveedor, el ÚLTIMO la versión de prompt, y TODO lo
 * del medio unido es el modelo. Los comodines `*` siguen funcionando (un `*`
 * como campo completo del modelo, ej. `deepinfra`/`*`/`buxo-assessor-v3`).
 */
export function isTripletaAllowed(allowlist: AssessorAggregationAllowlist, tripleta: AssessorTripleta): boolean {
  if (allowlist.length === 0) return false;
  return allowlist.some((entry) => {
    const parts = entry.split("/");
    if (parts.length < 3) return false; // malformada (faltan campos) — deny
    const providerId = parts[0];
    const promptVersion = parts[parts.length - 1];
    const modelId = parts.slice(1, -1).join("/");
    return (
      (providerId === "*" || providerId === tripleta.providerId) &&
      (modelId === "*" || modelId === tripleta.modelId) &&
      (promptVersion === "*" || promptVersion === tripleta.promptVersion)
    );
  });
}

function tripletaOf(a: Assessment): AssessorTripleta {
  return { providerId: a.assessorProviderId, modelId: a.assessorModelId, promptVersion: a.assessorPromptVersion };
}

// ---------------------------------------------------------------------------
// Run config bag — threaded through AppDeps (deps.ts), built once at boot
// (index.ts) from env.ts + DEFAULT_MASTERY_AGGREGATION_CONFIG.
// ---------------------------------------------------------------------------

export interface MasteryAggregationRunConfig {
  aggregation: MasteryAggregationConfig;
  visibilityMode: MasteryVisibility;
  allowlist: AssessorAggregationAllowlist;
}

export const DEFAULT_MASTERY_AGGREGATION_RUN_CONFIG: MasteryAggregationRunConfig = {
  aggregation: DEFAULT_MASTERY_AGGREGATION_CONFIG,
  visibilityMode: "shadow",
  allowlist: [],
};

// ---------------------------------------------------------------------------
// applyAssessmentToMastery — B2 §1.6 (rollup) / §3.2 (per-topic) / §7.2 (gate)
// ---------------------------------------------------------------------------

export interface ApplyAssessmentToMasteryInput {
  session: Pick<StudySession, "userId" | "subjectId">;
  /** Already persisted (recordAssessment already ran) — this function is called AFTER, per §9.4. */
  assessment: Assessment;
  config: MasteryAggregationRunConfig;
}

export interface ApplyAssessmentToMasteryResult {
  /** `false` when the tripleta isn't allowed — neither rollup nor per-topic ran (B2 §7.2: the Assessment is still saved, just excluded from aggregation). */
  aggregated: boolean;
  /** `true` when THIS call materialized a brand-new per-topic MasteryState (B2 §3.2). */
  materializedTopic: boolean;
  /**
   * The rollup `MasteryLevel` AFTER this assessment was applied.
   * Only meaningful when `aggregated === true`. G2 (gamification wiring)
   * uses this to detect tier changes for achievement awarding.
   */
  nextRollupLevel: MasteryLevel | null;
  /**
   * The per-topic `MasteryLevel` AFTER this assessment was applied.
   * `null` when the assessment had no topicKey or the topic wasn't
   * materialized yet. G2 uses this for topic-scoped achievement awarding.
   */
  nextTopicLevel: MasteryLevel | null;
  /**
   * Whether the tier changed for rollup and/or topic as a result of
   * this assessment. G2 uses this to decide whether to run
   * `maybeAwardAchievements`.
   */
  tierChanged: { rollup: boolean; topic: boolean };
}

export async function applyAssessmentToMastery(
  db: Db,
  input: ApplyAssessmentToMasteryInput,
): Promise<ApplyAssessmentToMasteryResult> {
  const { session, assessment, config } = input;

  // §7.2 — a non-approved tripleta never feeds aggregation, in either scope.
  if (!isTripletaAllowed(config.allowlist, tripletaOf(assessment))) {
    return { aggregated: false, materializedTopic: false, nextRollupLevel: null, nextTopicLevel: null, tierChanged: { rollup: false, topic: false } };
  }

  // --- Rollup (topicKey "", §1.6) — incremental, unconditional. ---
  const prevRollup = await findMasteryState(db, session.userId, session.subjectId, SUBJECT_ROLLUP_TOPIC_KEY);
  const prevRollupTier = prevRollup?.currentLevel.tier ?? null;
  const nextRollupLevel = aggregate(prevRollup?.currentLevel ?? null, assessment, config.aggregation);
  await writeMasteryState(db, {
    userId: session.userId,
    subjectId: session.subjectId,
    topicKey: SUBJECT_ROLLUP_TOPIC_KEY,
    level: nextRollupLevel,
    visibility: config.visibilityMode,
    computedByVersion: B2_AGGREGATION_VERSION,
    contributingAssessmentIds: [assessment.id],
  });

  const rollupTierChanged = prevRollupTier !== null && prevRollupTier !== nextRollupLevel.tier;

  let materializedTopic = false;
  let nextTopicLevel: MasteryLevel | null = null;
  let topicTierChanged = false;

  // --- Per-topic (§3.2) — only when THIS Assessment carries a normalized topicKey. ---
  if (assessment.topicKey !== null) {
    const topicKey = assessment.topicKey;
    const existingTopicState = await findMasteryState(db, session.userId, session.subjectId, topicKey);
    const prevTopicTier = existingTopicState?.currentLevel.tier ?? null;

    if (existingTopicState) {
      nextTopicLevel = aggregate(existingTopicState.currentLevel, assessment, config.aggregation);
      await writeMasteryState(db, {
        userId: session.userId,
        subjectId: session.subjectId,
        topicKey,
        level: nextTopicLevel,
        visibility: config.visibilityMode,
        computedByVersion: B2_AGGREGATION_VERSION,
        contributingAssessmentIds: [assessment.id],
      });
      topicTierChanged = prevTopicTier !== null && prevTopicTier !== nextTopicLevel.tier;
    } else {
      // maybeMaterializeTopic (§3.2) — the SAME tripleta filter applies to the whole replay set (B2 §3.2/§7.2's "aplicando el mismo filtro").
      const taggedAssessments = await listAssessmentsBySubject(db, session.subjectId, { topicKey });
      const candidates = taggedAssessments.filter((a) => isTripletaAllowed(config.allowlist, tripletaOf(a)));

      if (candidates.length >= config.aggregation.topicMaterializationThreshold) {
        const materializedLevel = foldMasteryLevel(candidates, {}, config.aggregation);
        if (materializedLevel !== null) {
          nextTopicLevel = materializedLevel;
          const contributingAssessmentIds = candidates.map((a) => a.id);
          const { historyEntry } = await writeMasteryState(db, {
            userId: session.userId,
            subjectId: session.subjectId,
            topicKey,
            level: materializedLevel,
            visibility: config.visibilityMode,
            computedByVersion: B2_AGGREGATION_VERSION,
            contributingAssessmentIds,
          });
          // I-9 executable proxy — every contributing Assessment must actually belong to this subject.
          assertMasteryHistoryEntryAssessmentsScopedToSubject(historyEntry, candidates);
          materializedTopic = true;
          // On materialization, the topic goes from non-existent to its first tier.
          // If the first tier is different from null (which it always is), that's a "change".
          topicTierChanged = true;
        }
      }
    }
  }

  return {
    aggregated: true,
    materializedTopic,
    nextRollupLevel,
    nextTopicLevel,
    tierChanged: { rollup: rollupTierChanged, topic: topicTierChanged },
  };
}

// ---------------------------------------------------------------------------
// runMasteryDecaySweep — B2 §1.5/§9.4
// ---------------------------------------------------------------------------

export interface MasteryDecaySweepResult {
  scanned: number;
  decayed: number;
}

/**
 * Periodic job (B3 §5.1's backfill-job pattern, scheduled from
 * `src/index.ts`) — sweeps every `MasteryState` row and steps down any
 * that's gone stale (§1.5). Writes a new `MasteryHistoryEntry` with
 * `contributingAssessmentIds: []` (the EMPTY array is the "this was decay,
 * not new evidence" signal, not a bug) only for rows that actually
 * changed — `applyDecay` returning `null` means "no write" (§1.5: "no se
 * escribe historia sin evento real").
 */
export async function runMasteryDecaySweep(db: Db, now: Date, config: MasteryAggregationRunConfig): Promise<MasteryDecaySweepResult> {
  const states = await listAllMasteryStates(db);
  const nowIso = now.toISOString();
  let decayed = 0;

  for (const state of states) {
    const decayedLevel = applyDecay(state.currentLevel, nowIso, config.aggregation);
    if (decayedLevel === null) continue;

    await writeMasteryState(db, {
      userId: state.userId,
      subjectId: state.subjectId,
      topicKey: state.topicKey,
      level: decayedLevel,
      visibility: config.visibilityMode,
      computedByVersion: B2_AGGREGATION_VERSION,
      contributingAssessmentIds: [],
    });
    decayed += 1;
  }

  return { scanned: states.length, decayed };
}
