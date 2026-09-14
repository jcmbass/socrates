import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import { users } from "../../src/db/schema";
import { recordAssessment } from "../../src/repositories/assessments";
import { createStudySession } from "../../src/repositories/study-sessions";
import { createExchange } from "../../src/repositories/exchanges";
import { applyAssessmentToMastery } from "../../src/mastery/aggregate";
import { applyGamificationAfterMastery } from "../../src/mastery/gamification-wiring";
import { findStreak } from "../../src/repositories/streaks";
import { seedChallengeDefinitions } from "../../src/seeds/challenge-definitions";
import type { AssessorVerdict } from "@buxo/core/assess";

interface InspectMasteryStateBody {
  topicKey: string;
  currentLevel: { tier: string };
  visibility: string;
  history: Array<{ id: string; contributingAssessmentIds: string[] }>;
}
interface InspectBody {
  states: InspectMasteryStateBody[];
  unmaterializedTopicCounts: Array<{ topicKey: string; count: number }>;
}

interface AchievementsInspectBody {
  achievements: Array<{ id: string; challengeDefinitionId: string; status: string }>;
  definitions: Array<{ id: string; titleKey: string }>;
}

describe("GET /v1/mastery/:subjectId and GET /v1/achievements — F1 scope (B2/gamification are F2/F3)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("mastery is always 404 in F1 — never leaks 'hidden:true' (O-5)", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "mastery@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<{ id: string }>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<{ id: string }>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Cálculo" }) }),
    );

    const res = await app.request(`/v1/mastery/${subject.id}`, { headers });
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body).not.toHaveProperty("hidden");
  });

  it("mastery 404s for a subject that isn't the caller's own, without distinguishing 'not found' from 'not yours'", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "mastery-owner@example.com");
    const res = await app.request("/v1/mastery/not-a-real-subject", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
  });

  it("achievements is shadow in F3 — always 404 for students (R-4: Achievement/score en sombra hasta F4)", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "achievements@example.com");

    const unauth = await app.request("/v1/achievements");
    expect(unauth.status).toBe(401);

    const res = await app.request("/v1/achievements", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body).not.toHaveProperty("hidden");
  });
});

describe("GET /v1/mastery/:subjectId/inspect — founder-only auditory tool (F2 WQ3 parte B4, B2 §5.2)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setupOwnerAndSubject(email: string) {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<{ id: string }>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<{ id: string; name: string }>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Cálculo" }) }),
    );

    return { app, headers, userId, subject };
  }

  async function promoteToInternalDev(userId: string) {
    await ctx.deps.db.update(users).set({ accountKind: "internal_dev" }).where(eq(users.id, userId));
  }

  it("a student (non-internal_dev) gets the exact same not_found as the student route, never a distinguishing signal", async () => {
    const { app, headers, subject } = await setupOwnerAndSubject("inspect-student@example.com");

    const res = await app.request(`/v1/mastery/${subject.id}/inspect`, { headers });
    expect(res.status).toBe(404);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("not_found");
  });

  it("internal_dev inspecting a subject that isn't theirs (or doesn't exist) also 404s (ownership scoping, see route's DEVIATION note)", async () => {
    const { app, headers, userId } = await setupOwnerAndSubject("inspect-dev-no-subject@example.com");
    await promoteToInternalDev(userId);

    const res = await app.request(`/v1/mastery/not-a-real-subject/inspect`, { headers });
    expect(res.status).toBe(404);
  });

  it("internal_dev sees the full payload — states (rollup + per-topic) with history, and unmaterialized topic counts — even while MASTERY_VISIBILITY_MODE is shadow", async () => {
    const { app, headers, userId, subject } = await setupOwnerAndSubject("inspect-dev@example.com");
    await promoteToInternalDev(userId);

    const session = await createStudySession(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      subjectNameSnapshot: subject.name,
      initialBand: "guiding",
      materialAssetIds: [],
      materialSnapshotTextRef: null,
      materialSnapshotInfo: null,
    });

    const strongVerdict: AssessorVerdict = {
      demonstratedUnderstanding: "solid",
      explainedInOwnWords: true,
      guessedOrPatternMatched: false,
      recommendedBand: "minimal",
      rationale: "Explicó con solidez.",
    };

    // 3x same normalized topic -> rollup moves AND the topic materializes (B2 §3.2, threshold 3).
    for (let i = 0; i < 3; i++) {
      const exchange = await createExchange(ctx.deps.db, {
        sessionId: session.id,
        index: i,
        studentMessage: `m${i}`,
        tutorReply: `r${i}`,
        band: "guiding",
        tutorPromptVersion: "buxo-socratic-v3",
        tutorModelId: "claude-sonnet-5",
        tutorProviderId: "anthropic",
      });
      const assessment = await recordAssessment(ctx.deps.db, {
        sessionId: session.id,
        exchangeId: exchange.id,
        subjectId: subject.id,
        verdict: strongVerdict,
        topicKeyRaw: "Fracciones equivalentes",
        assessorPromptVersion: "buxo-assessor-v2",
        assessorModelId: "claude-sonnet-5",
        assessorProviderId: "anthropic",
      });
      await applyAssessmentToMastery(ctx.deps.db, { session, assessment, config: ctx.deps.masteryAggregationConfig });
    }

    // One more assessment tagged with a DIFFERENT topic that never reaches the materialization threshold.
    const strayExchange = await createExchange(ctx.deps.db, {
      sessionId: session.id,
      index: 3,
      studentMessage: "m3",
      tutorReply: "r3",
      band: "guiding",
      tutorPromptVersion: "buxo-socratic-v3",
      tutorModelId: "claude-sonnet-5",
      tutorProviderId: "anthropic",
    });
    const strayAssessment = await recordAssessment(ctx.deps.db, {
      sessionId: session.id,
      exchangeId: strayExchange.id,
      subjectId: subject.id,
      verdict: strongVerdict,
      topicKeyRaw: "Derivadas",
      assessorPromptVersion: "buxo-assessor-v2",
      assessorModelId: "claude-sonnet-5",
      assessorProviderId: "anthropic",
    });
    await applyAssessmentToMastery(ctx.deps.db, { session, assessment: strayAssessment, config: ctx.deps.masteryAggregationConfig });

    const res = await app.request(`/v1/mastery/${subject.id}/inspect`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<InspectBody>(res);

    const topicKeys = body.states.map((s) => s.topicKey).sort();
    expect(topicKeys).toEqual(["", "fracciones-equivalentes"].sort());

    const rollup = body.states.find((s) => s.topicKey === "")!;
    expect(rollup.visibility).toBe("shadow"); // §5.1: founder still sees it even though it's shadow
    expect(rollup.currentLevel.tier).toBe("developing"); // 3 strongPositive in a row -> emerging -> developing
    expect(rollup.history.length).toBeGreaterThan(0);

    const topic = body.states.find((s) => s.topicKey === "fracciones-equivalentes")!;
    expect(topic.currentLevel.tier).toBe("developing");
    expect(topic.history).toHaveLength(1); // born materialized, one history entry

    // "Derivadas" only has 1 tagged Assessment — never materialized, shows up as an unmaterialized count instead.
    const derivadas = body.unmaterializedTopicCounts.find((t) => t.topicKey === "derivadas");
    expect(derivadas?.count).toBe(1);
    // "fracciones-equivalentes" IS materialized -> excluded from unmaterialized counts.
    expect(body.unmaterializedTopicCounts.some((t) => t.topicKey === "fracciones-equivalentes")).toBe(false);
  });

  it("internal_dev with no mastery data yet gets an empty, well-formed payload (not an error)", async () => {
    const { app, headers, userId, subject } = await setupOwnerAndSubject("inspect-dev-empty@example.com");
    await promoteToInternalDev(userId);

    const res = await app.request(`/v1/mastery/${subject.id}/inspect`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<InspectBody>(res);
    expect(body).toEqual({ states: [], unmaterializedTopicCounts: [] });
  });
});

// ---------------------------------------------------------------------------
// G2 (F3) — Streak, Activity, Achievements inspect
// ---------------------------------------------------------------------------

describe("GET /v1/streak — visible in F3 (R-4)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("returns 0/0 when no streak exists yet", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "streak-empty@example.com");

    const res = await app.request("/v1/streak", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toEqual({ current: 0, longest: 0, reasonKeys: [] });
  });

  it("returns current streak after qualifying assessments via gamification wiring", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "streak-active@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<{ id: string }>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<{ id: string; name: string }>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Cálculo" }) }),
    );

    const session = await createStudySession(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      subjectNameSnapshot: subject.name,
      initialBand: "guiding",
      materialAssetIds: [],
      materialSnapshotTextRef: null,
      materialSnapshotInfo: null,
    });

    // Seed challenge definitions for this subject so achievements can be awarded.
    await seedChallengeDefinitions(ctx.deps.db, subject.id);

    // 3 qualifying assessments -> streak should be 3.
    for (let i = 0; i < 3; i++) {
      const exchange = await createExchange(ctx.deps.db, {
        sessionId: session.id,
        index: i,
        studentMessage: `m${i}`,
        tutorReply: `r${i}`,
        band: "guiding",
        tutorPromptVersion: "buxo-socratic-v3",
        tutorModelId: "claude-sonnet-5",
        tutorProviderId: "anthropic",
      });
      const assessment = await recordAssessment(ctx.deps.db, {
        sessionId: session.id,
        exchangeId: exchange.id,
        subjectId: subject.id,
        verdict: {
          demonstratedUnderstanding: "developing",
          explainedInOwnWords: true,
          guessedOrPatternMatched: false,
          recommendedBand: "probing",
          rationale: "Explicó con sus propias palabras.",
        },
        topicKeyRaw: null,
        assessorPromptVersion: "buxo-assessor-v2",
        assessorModelId: "claude-sonnet-5",
        assessorProviderId: "anthropic",
      });
      const masteryResult = await applyAssessmentToMastery(ctx.deps.db, {
        session,
        assessment,
        config: ctx.deps.masteryAggregationConfig,
      });
      await applyGamificationAfterMastery(ctx.deps.db, {
        userId,
        subjectId: subject.id,
        topicId: null,
        assessment,
        masteryResult,
      });
    }

    const streak = await findStreak(ctx.deps.db, userId);
    expect(streak).not.toBeNull();
    expect(streak!.current).toBe(3);
    expect(streak!.longest).toBe(3);

    // Verify via HTTP.
    const res = await app.request("/v1/streak", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = await readJson<{ current: number; longest: number; reasonKeys: string[] }>(res);
    expect(body.current).toBe(3);
    expect(body.longest).toBe(3);
    expect(body.reasonKeys).toContain("EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS");
    expect(body.reasonKeys).toContain("SUSTAINED_OVER_TIME");
  });

  it("a non-qualifying assessment (guessed) resets streak to 0", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "streak-broken@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<{ id: string }>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<{ id: string; name: string }>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Cálculo" }) }),
    );

    const session = await createStudySession(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      subjectNameSnapshot: subject.name,
      initialBand: "guiding",
      materialAssetIds: [],
      materialSnapshotTextRef: null,
      materialSnapshotInfo: null,
    });

    // Qualifying assessment.
    const exchange1 = await createExchange(ctx.deps.db, {
      sessionId: session.id, index: 0, studentMessage: "m0", tutorReply: "r0",
      band: "guiding", tutorPromptVersion: "v3", tutorModelId: "sonnet-5", tutorProviderId: "anthropic",
    });
    const a1 = await recordAssessment(ctx.deps.db, {
      sessionId: session.id, exchangeId: exchange1.id, subjectId: subject.id,
      verdict: { demonstratedUnderstanding: "developing", explainedInOwnWords: true, guessedOrPatternMatched: false, recommendedBand: "probing", rationale: "ok" },
      assessorPromptVersion: "v2", assessorModelId: "sonnet-5", assessorProviderId: "anthropic",
    });
    const r1 = await applyAssessmentToMastery(ctx.deps.db, { session, assessment: a1, config: ctx.deps.masteryAggregationConfig });
    await applyGamificationAfterMastery(ctx.deps.db, { userId, subjectId: subject.id, topicId: null, assessment: a1, masteryResult: r1 });

    // Non-qualifying assessment (guessed).
    const exchange2 = await createExchange(ctx.deps.db, {
      sessionId: session.id, index: 1, studentMessage: "m1", tutorReply: "r1",
      band: "guiding", tutorPromptVersion: "v3", tutorModelId: "sonnet-5", tutorProviderId: "anthropic",
    });
    const a2 = await recordAssessment(ctx.deps.db, {
      sessionId: session.id, exchangeId: exchange2.id, subjectId: subject.id,
      verdict: { demonstratedUnderstanding: "solid", explainedInOwnWords: true, guessedOrPatternMatched: true, recommendedBand: "minimal", rationale: "guess" },
      assessorPromptVersion: "v2", assessorModelId: "sonnet-5", assessorProviderId: "anthropic",
    });
    const r2 = await applyAssessmentToMastery(ctx.deps.db, { session, assessment: a2, config: ctx.deps.masteryAggregationConfig });
    await applyGamificationAfterMastery(ctx.deps.db, { userId, subjectId: subject.id, topicId: null, assessment: a2, masteryResult: r2 });

    const streak = await findStreak(ctx.deps.db, userId);
    expect(streak).not.toBeNull();
    expect(streak!.current).toBe(0);
    expect(streak!.longest).toBe(1); // longest never decreases
  });
});

describe("GET /v1/activity — honest signals (A §5.2)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("returns activity data for a user with sessions", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "activity@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<{ id: string }>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<{ id: string; name: string }>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Cálculo" }) }),
    );

    // Create a session.
    const session = await readJson<{ id: string }>(
      await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id }) }),
    );

    const res = await app.request("/v1/activity", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = await readJson<{ recentSessionCount: number; totalExchangeCount: number; streak: { current: number; longest: number } }>(res);
    expect(body).toHaveProperty("recentSessionCount");
    expect(body).toHaveProperty("totalExchangeCount");
    expect(body).toHaveProperty("streak");
    expect(body.streak).toEqual({ current: 0, longest: 0 });
  });
});

describe("GET /v1/achievements/:subjectId/inspect — founder-only (F3 G2)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setupOwnerAndSubject(email: string) {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<{ id: string }>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<{ id: string; name: string }>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Cálculo" }) }),
    );

    return { app, headers, userId, subject };
  }

  async function promoteToInternalDev(userId: string) {
    await ctx.deps.db.update(users).set({ accountKind: "internal_dev" }).where(eq(users.id, userId));
  }

  it("a student (non-internal_dev) gets 404, same as the student route", async () => {
    const { app, headers, subject } = await setupOwnerAndSubject("ach-inspect-student@example.com");

    const res = await app.request(`/v1/achievements/${subject.id}/inspect`, { headers });
    expect(res.status).toBe(404);
  });

  it("internal_dev sees achievements and definitions for their subject", async () => {
    const { app, headers, userId, subject } = await setupOwnerAndSubject("ach-inspect-dev@example.com");
    await promoteToInternalDev(userId);

    // Seed challenge definitions.
    await seedChallengeDefinitions(ctx.deps.db, subject.id);

    const res = await app.request(`/v1/achievements/${subject.id}/inspect`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<AchievementsInspectBody>(res);
    expect(body).toHaveProperty("achievements");
    expect(body).toHaveProperty("definitions");
    expect(body.definitions.length).toBeGreaterThanOrEqual(2); // consolidated + mastered
  });

  it("internal_dev with no achievements sees seeded definitions", async () => {
    const { app, headers, userId, subject } = await setupOwnerAndSubject("ach-inspect-empty@example.com");
    await promoteToInternalDev(userId);

    const res = await app.request(`/v1/achievements/${subject.id}/inspect`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<AchievementsInspectBody>(res);
    expect(body.achievements).toEqual([]);
    expect(body.definitions.length).toBeGreaterThanOrEqual(2);
    expect(body.definitions.map((d) => d.titleKey)).toContain("challenge.consolidated.subject.title");
    expect(body.definitions.map((d) => d.titleKey)).toContain("challenge.mastered.subject.title");
  });
});
