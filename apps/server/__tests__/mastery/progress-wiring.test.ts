/**
 * Plan-xp-progreso Fase 1 — progress wiring tests.
 *
 * Covers: evidence XP table, Tema.status studying/done, Tema.stars from
 * tierToStars (same function as routes/mastery — not a second map).
 */
import { afterEach, describe, expect, it } from "vitest";
import { tierToStars } from "@buxo/domain/mastery";
import { evidenceXpFromVerdict } from "@buxo/domain/xp";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody } from "../support/http-types";
import { applyGamificationAfterMastery } from "../../src/mastery/gamification-wiring";
import { createStudySession } from "../../src/repositories/study-sessions";
import { createExchange } from "../../src/repositories/exchanges";
import { recordAssessment } from "../../src/repositories/assessments";
import { findTemarioBySubject, markTopicStudyingIfNew, updateTopicInTemario } from "../../src/repositories/temarios";
import { listXpEventsByUser } from "../../src/repositories/xp";
import { eq } from "drizzle-orm";
import { temas } from "../../src/db/schema";
import type { ApplyAssessmentToMasteryResult } from "../../src/mastery/aggregate";

interface TopicBody {
  id: string;
  status: string;
  stars: number;
  title: string;
}

describe("plan-xp-progreso Fase 1 — progress wiring", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setup() {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, `progress-${Date.now()}@example.com`);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Química" }) }),
    );
    const topic = await readJson<TopicBody>(
      await app.request(`/v1/temario/${subject.id}/topics`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Estructura atómica" }),
      }),
    );
    return { app, headers, userId, subject, topic };
  }

  function level(tier: "emerging" | "developing" | "consolidated" | "mastered") {
    return {
      tier,
      positiveStreak: 0,
      negativeStreak: 0,
      strongCount: 0,
      recentStrongEvidence: [] as [],
      lastPositiveAt: new Date().toISOString(),
      lastPromotionAt: null,
    };
  }

  it("evidence table: guessed → 0; developing+ownWords → 3; solid+ownWords → 4", () => {
    expect(
      evidenceXpFromVerdict({
        demonstratedUnderstanding: "solid",
        explainedInOwnWords: true,
        guessedOrPatternMatched: true,
      }),
    ).toBeNull();
    expect(
      evidenceXpFromVerdict({
        demonstratedUnderstanding: "developing",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
      }),
    ).toEqual({ delta: 3, reason: "evidence_developing_own_words" });
    expect(
      evidenceXpFromVerdict({
        demonstratedUnderstanding: "solid",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
      }),
    ).toEqual({ delta: 4, reason: "evidence_solid_own_words" });
  });

  it("opening a topic session marks Tema.status studying (from new)", async () => {
    const { app, headers, subject, topic } = await setup();
    expect(topic.status).toBe("new");

    const res = await app.request("/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectId: subject.id, topicId: topic.id }),
    });
    expect(res.status).toBe(201);

    const temario = await findTemarioBySubject(ctx.deps.db, subject.id);
    const updated = temario!.topics.find((t) => t.id === topic.id)!;
    expect(updated.status).toBe("studying");
  });

  it("markTopicStudyingIfNew is a no-op when already studying/done", async () => {
    const { topic } = await setup();
    await updateTopicInTemario(ctx.deps.db, { id: topic.id, status: "done" });
    await markTopicStudyingIfNew(ctx.deps.db, topic.id);
    const [row] = await ctx.deps.db.select().from(temas).where(eq(temas.id, topic.id));
    expect(row!.status).toBe("done");
  });

  it("Tema.stars come from tierToStars; consolidated → status done + 2 stars", async () => {
    const { userId, subject, topic } = await setup();

    // Confirm we use the SAME function routes/mastery uses — not a copy.
    expect(tierToStars("consolidated")).toBe(2);
    expect(tierToStars("mastered")).toBe(3);

    const session = await createStudySession(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      subjectNameSnapshot: "Química",
      kind: "topic",
      topicId: topic.id,
      initialBand: "guiding",
      materialAssetIds: [],
      materialSnapshotTextRef: null,
      materialSnapshotInfo: null,
    });
    await markTopicStudyingIfNew(ctx.deps.db, topic.id);

    const exchange = await createExchange(ctx.deps.db, {
      sessionId: session.id,
      index: 0,
      studentMessage: "explico con mis palabras",
      tutorReply: "bien",
      band: "guiding",
      tutorPromptVersion: "v3",
      tutorModelId: "fake",
      tutorProviderId: "fake",
    });
    const assessment = await recordAssessment(ctx.deps.db, {
      sessionId: session.id,
      exchangeId: exchange.id,
      subjectId: subject.id,
      verdict: {
        demonstratedUnderstanding: "solid",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
        recommendedBand: "minimal",
        rationale: "ok",
      },
      topicKeyRaw: "Estructura atómica",
      assessorPromptVersion: "v3",
      assessorModelId: "fake",
      assessorProviderId: "fake",
    });

    // Simulate mastery having produced a consolidated topic level.
    const masteryResult: ApplyAssessmentToMasteryResult = {
      aggregated: true,
      materializedTopic: true,
      nextRollupLevel: level("developing"),
      nextTopicLevel: level("consolidated"),
      tierChanged: { rollup: true, topic: true },
    };

    const result = await applyGamificationAfterMastery(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      topicId: topic.id,
      assessment,
      masteryResult,
    });

    expect(result.temaProgressUpdated).toBe(true);
    expect(result.xpRecorded).toBe(true);

    const temario = await findTemarioBySubject(ctx.deps.db, subject.id);
    const updated = temario!.topics.find((t) => t.id === topic.id)!;
    expect(updated.stars).toBe(tierToStars("consolidated"));
    expect(updated.status).toBe("done");

    const events = await listXpEventsByUser(ctx.deps.db, userId, { subjectId: subject.id });
    expect(events).toHaveLength(1);
    expect(events[0]!.delta).toBe(4);
    expect(events[0]!.reason).toBe("evidence_solid_own_words");
  });

  it("guessed assessment records no XP event", async () => {
    const { userId, subject, topic } = await setup();
    const session = await createStudySession(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      subjectNameSnapshot: "Química",
      topicId: topic.id,
      initialBand: "guiding",
      materialAssetIds: [],
      materialSnapshotTextRef: null,
      materialSnapshotInfo: null,
    });
    const exchange = await createExchange(ctx.deps.db, {
      sessionId: session.id,
      index: 0,
      studentMessage: "42",
      tutorReply: "hmm",
      band: "guiding",
      tutorPromptVersion: "v3",
      tutorModelId: "fake",
      tutorProviderId: "fake",
    });
    const assessment = await recordAssessment(ctx.deps.db, {
      sessionId: session.id,
      exchangeId: exchange.id,
      subjectId: subject.id,
      verdict: {
        demonstratedUnderstanding: "solid",
        explainedInOwnWords: true,
        guessedOrPatternMatched: true,
        recommendedBand: "minimal",
        rationale: "guess",
      },
      assessorPromptVersion: "v3",
      assessorModelId: "fake",
      assessorProviderId: "fake",
    });

    const masteryResult: ApplyAssessmentToMasteryResult = {
      aggregated: false,
      materializedTopic: false,
      nextRollupLevel: null,
      nextTopicLevel: null,
      tierChanged: { rollup: false, topic: false },
    };

    const result = await applyGamificationAfterMastery(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      topicId: topic.id,
      assessment,
      masteryResult,
    });
    expect(result.xpRecorded).toBe(false);
    expect(await listXpEventsByUser(ctx.deps.db, userId)).toHaveLength(0);
  });

  it("GET temario includes visibility; stars zeroed in shadow", async () => {
    const { app, headers, subject, topic } = await setup();
    await updateTopicInTemario(ctx.deps.db, { id: topic.id, stars: 3, status: "done" });

    const res = await app.request(`/v1/temario/${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<{ visibility: string; topics: TopicBody[] }>(res);
    expect(body.visibility).toBe("shadow");
    expect(body.topics[0]!.stars).toBe(0);
    expect(body.topics[0]!.status).toBe("done"); // status survives shadow
  });
});
