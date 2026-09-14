/**
 * Integration tests for `src/mastery/aggregate.ts` — F2 WQ3 parte B3.
 * Exercises the SERVICE layer (I/O wiring: reading/writing
 * `repositories/mastery.ts`, reading `repositories/assessments.ts`, gating
 * by tripleta, stamping visibility) against test-db directly — the pure
 * reducer math itself (`aggregate`/`applyDecay`/`foldMasteryLevel`) is
 * already covered by `packages/domain`'s own tests (parte A1); these tests
 * would fail if the WIRING were wrong even if the pure functions were
 * perfect (e.g. wrong scope passed, materialization threshold off-by-one,
 * tripleta filter not applied to the replay set).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import { createStudySession } from "../../src/repositories/study-sessions";
import { createExchange } from "../../src/repositories/exchanges";
import { recordAssessment, type RecordAssessmentInput } from "../../src/repositories/assessments";
import { findMasteryState, listMasteryHistoryByState, writeMasteryState } from "../../src/repositories/mastery";
import {
  applyAssessmentToMastery,
  isTripletaAllowed,
  parseAssessorAggregationAllowlist,
  runMasteryDecaySweep,
  type MasteryAggregationRunConfig,
} from "../../src/mastery/aggregate";
import { DEFAULT_MASTERY_AGGREGATION_CONFIG } from "@buxo/domain/mastery-engine";
import { SUBJECT_ROLLUP_TOPIC_KEY } from "@buxo/domain/sentinels";
import { assertMasteryHistoryEntryImmutable } from "@buxo/domain/invariants";
import type { AssessorVerdict } from "@buxo/core/assess";
import type { MasteryLevel } from "@buxo/domain/mastery";

const ALLOW_ALL_SHADOW: MasteryAggregationRunConfig = {
  aggregation: DEFAULT_MASTERY_AGGREGATION_CONFIG,
  visibilityMode: "shadow",
  allowlist: ["*/*/*"],
};

const TRIPLETA = { assessorPromptVersion: "buxo-assessor-v2", assessorModelId: "claude-sonnet-5", assessorProviderId: "anthropic" };

function positiveVerdict(overrides: Partial<AssessorVerdict> = {}): AssessorVerdict {
  return {
    demonstratedUnderstanding: "developing",
    explainedInOwnWords: true,
    guessedOrPatternMatched: false,
    recommendedBand: "probing",
    rationale: "Explicó el paso con sus propias palabras.",
    ...overrides,
  };
}

function strongVerdict(overrides: Partial<AssessorVerdict> = {}): AssessorVerdict {
  return positiveVerdict({ demonstratedUnderstanding: "solid", recommendedBand: "minimal", ...overrides });
}

describe("mastery/aggregate.ts — B3 (allowlist parsing, pure)", () => {
  it("unset/vacio -> deny-all (empty array, PB2)", () => {
    expect(parseAssessorAggregationAllowlist(undefined)).toEqual([]);
    expect(parseAssessorAggregationAllowlist("")).toEqual([]);
  });

  it("malformed JSON throws (fail-loud, same discipline as loadModelsConfig)", () => {
    expect(() => parseAssessorAggregationAllowlist("not json")).toThrow();
  });

  it("non-array or non-string entries throw", () => {
    expect(() => parseAssessorAggregationAllowlist('{"a":1}')).toThrow();
    expect(() => parseAssessorAggregationAllowlist("[1,2]")).toThrow();
  });

  it("isTripletaAllowed: wildcard allowlist allows everything", () => {
    expect(isTripletaAllowed(["*/*/*"], { providerId: "anthropic", modelId: "claude-sonnet-5", promptVersion: "buxo-assessor-v2" })).toBe(true);
  });

  it("isTripletaAllowed: exact match required per non-wildcard field", () => {
    const allowlist = parseAssessorAggregationAllowlist('["anthropic/claude-sonnet-5/buxo-assessor-v2"]');
    expect(isTripletaAllowed(allowlist, { providerId: "anthropic", modelId: "claude-sonnet-5", promptVersion: "buxo-assessor-v2" })).toBe(true);
    expect(isTripletaAllowed(allowlist, { providerId: "anthropic", modelId: "claude-sonnet-5", promptVersion: "buxo-assessor-v1" })).toBe(false);
  });

  it("isTripletaAllowed: '*' wildcards per field", () => {
    const allowlist = parseAssessorAggregationAllowlist('["anthropic/*/*"]');
    expect(isTripletaAllowed(allowlist, { providerId: "anthropic", modelId: "anything", promptVersion: "any-version" })).toBe(true);
    expect(isTripletaAllowed(allowlist, { providerId: "openai", modelId: "anything", promptVersion: "any-version" })).toBe(false);
  });

  it("isTripletaAllowed: empty allowlist denies everything (deny-by-default posture, WQ5/beta)", () => {
    expect(isTripletaAllowed([], { providerId: "anthropic", modelId: "claude-sonnet-5", promptVersion: "buxo-assessor-v2" })).toBe(false);
  });

  it("isTripletaAllowed: ids de DeepInfra con slash en el modelo (Qwen, DeepSeek) — el parser une el medio (guardia por mutación)", () => {
    // 🚨 BUG cazado por el arquitecto (2026-08-11): el parser viejo hacía
    // split("/") y exigía exactamente 3 partes. Los ids de DeepInfra llevan
    // slash adentro (Qwen/Qwen3.6-35B-A3B, deepseek-ai/DeepSeek-V4-Flash-0731)
    // → la tripleta daba 4 partes → DENEGADA EN SILENCIO (deny-by-default:
    // sin error, el mastery no acumula). Este test falla contra el parser
    // viejo y pasa contra el arreglado (primer segmento = proveedor, último =
    // versión, el medio unido = modelo).
    const allowlist = [
      "deepinfra/Qwen/Qwen3.6-35B-A3B/buxo-assessor-v3",
      "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731/buxo-assessor-v3",
    ];
    expect(
      isTripletaAllowed(allowlist, { providerId: "deepinfra", modelId: "Qwen/Qwen3.6-35B-A3B", promptVersion: "buxo-assessor-v3" }),
    ).toBe(true);
    expect(
      isTripletaAllowed(allowlist, { providerId: "deepinfra", modelId: "deepseek-ai/DeepSeek-V4-Flash-0731", promptVersion: "buxo-assessor-v3" }),
    ).toBe(true);
    // El wildcard de modelo sigue funcionando para ids con slash.
    expect(
      isTripletaAllowed(["deepinfra/*/buxo-assessor-v3"], { providerId: "deepinfra", modelId: "Qwen/Qwen3.6-35B-A3B", promptVersion: "buxo-assessor-v3" }),
    ).toBe(true);
  });
});

describe("applyAssessmentToMastery — B3", () => {
  let testDb: TestDb;

  afterEach(async () => {
    vi.useRealTimers();
    await testDb?.close();
  });

  async function fixture() {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, { email: "aggregate@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
    const course = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    const subject = await createSubject(testDb.db, { userId: user.id, courseId: course.id, name: "Cálculo" });
    const session = await createStudySession(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      subjectNameSnapshot: subject.name,
      initialBand: "guiding",
      materialAssetIds: [],
      materialSnapshotTextRef: null,
      materialSnapshotInfo: null,
    });
    return { user, subject, session };
  }

  async function recordAndApply(
    sessionRow: Awaited<ReturnType<typeof createStudySession>>,
    subjectId: string,
    index: number,
    input: Partial<RecordAssessmentInput> & { verdict: AssessorVerdict },
    config: MasteryAggregationRunConfig = ALLOW_ALL_SHADOW,
  ) {
    const exchange = await createExchange(testDb.db, {
      sessionId: sessionRow.id,
      index,
      studentMessage: `mensaje ${index}`,
      tutorReply: `respuesta ${index}`,
      band: "guiding",
      tutorPromptVersion: "buxo-socratic-v3",
      tutorModelId: "claude-sonnet-5",
      tutorProviderId: "anthropic",
    });
    const assessment = await recordAssessment(testDb.db, {
      sessionId: sessionRow.id,
      exchangeId: exchange.id,
      subjectId,
      ...TRIPLETA,
      ...input,
    });
    const result = await applyAssessmentToMastery(testDb.db, { session: sessionRow, assessment, config });
    return { assessment, result };
  }

  it("rollup materializes at emerging on the first Assessment, then promotes to developing at 3 positive signals", async () => {
    const { subject, session } = await fixture();

    for (let i = 0; i < 3; i++) {
      await recordAndApply(session, subject.id, i, { verdict: positiveVerdict() });
      const rollup = await findMasteryState(testDb.db, session.userId, subject.id, SUBJECT_ROLLUP_TOPIC_KEY);
      expect(rollup).not.toBeNull();
      if (i < 2) expect(rollup!.currentLevel.tier).toBe("emerging");
      else expect(rollup!.currentLevel.tier).toBe("developing");
    }
  });

  it("visibility is stamped from config.visibilityMode on every write", async () => {
    const { subject, session } = await fixture();
    const visibleConfig: MasteryAggregationRunConfig = { ...ALLOW_ALL_SHADOW, visibilityMode: "visible" };

    await recordAndApply(session, subject.id, 0, { verdict: positiveVerdict() }, visibleConfig);
    const rollup = await findMasteryState(testDb.db, session.userId, subject.id, SUBJECT_ROLLUP_TOPIC_KEY);
    expect(rollup!.visibility).toBe("visible");
  });

  it("a non-approved tripleta is excluded from aggregation entirely (rollup stays absent)", async () => {
    const { subject, session } = await fixture();
    const denyConfig: MasteryAggregationRunConfig = { aggregation: DEFAULT_MASTERY_AGGREGATION_CONFIG, visibilityMode: "shadow", allowlist: [] };

    const { result } = await recordAndApply(session, subject.id, 0, { verdict: strongVerdict() }, denyConfig);
    expect(result.aggregated).toBe(false);
    expect(result.materializedTopic).toBe(false);

    const rollup = await findMasteryState(testDb.db, session.userId, subject.id, SUBJECT_ROLLUP_TOPIC_KEY);
    expect(rollup).toBeNull(); // saved (recordAssessment ran) but never fed aggregation
  });

  it("per-topic MasteryState is NOT created before the 3rd recurrence of the same normalized topicKey, and materializes on the 3rd via fold replay over ALL contributing Assessments", async () => {
    const { subject, session } = await fixture();
    const ids: string[] = [];

    for (let i = 0; i < 3; i++) {
      const { assessment } = await recordAndApply(session, subject.id, i, {
        verdict: strongVerdict(),
        topicKeyRaw: "Fracciones Equivalentes",
      });
      ids.push(assessment.id);

      const topicState = await findMasteryState(testDb.db, session.userId, subject.id, "fracciones-equivalentes");
      if (i < 2) {
        expect(topicState).toBeNull();
      } else {
        expect(topicState).not.toBeNull();
        // 3 strongPositive in a row -> emerging -> developing (developingPositiveStreak threshold = 3, default config).
        expect(topicState!.currentLevel.tier).toBe("developing");
        const history = await listMasteryHistoryByState(testDb.db, session.userId, subject.id, "fracciones-equivalentes");
        expect(history).toHaveLength(1);
        // Materialization's contributingAssessmentIds = ALL assessments that fed the fold (B2 §3.2), not just recentStrongEvidence.
        expect(history[0].contributingAssessmentIds.slice().sort()).toEqual(ids.slice().sort());
      }
    }
  });

  it("rollup and per-topic states are independent — a positive with no topicKey never touches a materialized topic row", async () => {
    const { subject, session } = await fixture();
    for (let i = 0; i < 3; i++) {
      await recordAndApply(session, subject.id, i, { verdict: strongVerdict(), topicKeyRaw: "Derivadas" });
    }
    const topicBefore = await findMasteryState(testDb.db, session.userId, subject.id, "derivadas");
    expect(topicBefore).not.toBeNull();
    const topicLevelBefore = topicBefore!.currentLevel;

    await recordAndApply(session, subject.id, 3, { verdict: positiveVerdict() }); // no topicKeyRaw

    const topicAfter = await findMasteryState(testDb.db, session.userId, subject.id, "derivadas");
    expect(topicAfter!.currentLevel).toEqual(topicLevelBefore); // untouched
  });

  it("history entries accumulate (append-only) and satisfy I-3 across successive aggregation writes", async () => {
    const { subject, session } = await fixture();
    await recordAndApply(session, subject.id, 0, { verdict: positiveVerdict() });
    await recordAndApply(session, subject.id, 1, { verdict: positiveVerdict() });

    const history = await listMasteryHistoryByState(testDb.db, session.userId, subject.id, SUBJECT_ROLLUP_TOPIC_KEY);
    expect(history).toHaveLength(2);
    expect(history[0].id).not.toBe(history[1].id);
    expect(() => assertMasteryHistoryEntryImmutable(history[0], history[0])).not.toThrow();
  });
});

describe("runMasteryDecaySweep — B3 (B2 §1.5)", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  function developingLevel(lastPositiveAt: string): MasteryLevel {
    return {
      tier: "developing",
      positiveStreak: 3,
      negativeStreak: 0,
      strongCount: 0,
      recentStrongEvidence: [],
      lastPositiveAt,
      lastPromotionAt: null,
    };
  }

  it("demotes a stale MasteryState and writes a history entry with contributingAssessmentIds: []", async () => {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, { email: "decay@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
    const course = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    const subject = await createSubject(testDb.db, { userId: user.id, courseId: course.id, name: "Cálculo" });

    const longAgo = new Date("2020-01-01T00:00:00.000Z").toISOString();
    await writeMasteryState(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      topicKey: SUBJECT_ROLLUP_TOPIC_KEY,
      level: developingLevel(longAgo),
      visibility: "shadow",
      computedByVersion: DEFAULT_MASTERY_AGGREGATION_CONFIG.version,
      contributingAssessmentIds: ["seed-a1"],
    });

    const result = await runMasteryDecaySweep(testDb.db, new Date(), ALLOW_ALL_SHADOW);
    expect(result.scanned).toBe(1);
    expect(result.decayed).toBe(1);

    const state = await findMasteryState(testDb.db, user.id, subject.id, SUBJECT_ROLLUP_TOPIC_KEY);
    expect(state!.currentLevel.tier).toBe("emerging"); // developing (45-day staleness) floored at emerging

    const history = await listMasteryHistoryByState(testDb.db, user.id, subject.id, SUBJECT_ROLLUP_TOPIC_KEY);
    expect(history).toHaveLength(2);
    expect(history[1].contributingAssessmentIds).toEqual([]); // decay event, not new evidence
  });

  it("a fresh MasteryState (lastPositiveAt recent) is left untouched — no history entry written", async () => {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, { email: "decay-fresh@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
    const course = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    const subject = await createSubject(testDb.db, { userId: user.id, courseId: course.id, name: "Cálculo" });

    await writeMasteryState(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      topicKey: SUBJECT_ROLLUP_TOPIC_KEY,
      level: developingLevel(new Date().toISOString()),
      visibility: "shadow",
      computedByVersion: DEFAULT_MASTERY_AGGREGATION_CONFIG.version,
      contributingAssessmentIds: ["seed-a1"],
    });

    const result = await runMasteryDecaySweep(testDb.db, new Date(), ALLOW_ALL_SHADOW);
    expect(result.decayed).toBe(0);

    const history = await listMasteryHistoryByState(testDb.db, user.id, subject.id, SUBJECT_ROLLUP_TOPIC_KEY);
    expect(history).toHaveLength(1); // only the seed write, no decay write
  });
});
