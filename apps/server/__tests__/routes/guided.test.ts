/**
 * Route tests for guided session topic_items — D1-b/c.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app";
import { buildTestDeps, type BuildTestDepsOptions, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody } from "../support/http-types";
import { topicItems, usageQuotas, quotaRejections } from "../../src/db/schema";
import { XP_GUIDED_CORRECT, XP_GUIDED_RETRY, XP_GUIDED_SESSION } from "@buxo/domain/xp";
import { parseTopicItemsPayload } from "@buxo/domain/guided-item";
import { recordUsage } from "../../src/repositories/quotas";
import { GUIDED_ITEMS_FAILURE_COOLDOWN_MS } from "../../src/repositories/topic-items";

interface TopicBody {
  id: string;
  title: string;
}

interface GuidedItemBody {
  id: string;
  type: string;
  difficulty: number;
  prompt: string;
  options: string[];
  explanation: string;
  answer?: unknown;
}

interface EnsureItemsBody {
  items: GuidedItemBody[];
  degraded: boolean;
  degradedReason: "generation_failed" | "sources_required" | null;
  grounding: "sources" | "general";
  generatorVersion: string;
}

describe("guided topic_items routes", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setupUser(email: string, envOverrides: BuildTestDepsOptions["envOverrides"] = {}, now?: () => Date) {
    ctx = await buildTestDeps({ envOverrides: { BUXO_FAKE_MODELS: true, ...envOverrides }, now });
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Física" }) }),
    );
    const topic = await readJson<TopicBody>(
      await app.request(`/v1/temario/${subject.id}/topics`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Movimiento rectilíneo" }),
      }),
    );

    return { app, token, userId, headers, subject, topic };
  }

  it("ensure×2 creates one row and strips answers from response", async () => {
    const { app, headers, subject, topic } = await setupUser("guided-ensure@example.com");

    const path = `/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`;
    const first = await app.request(path, { method: "POST", headers });
    expect(first.status).toBe(200);
    const body1 = await readJson<EnsureItemsBody>(first);
    expect(body1.degraded).toBe(false);
    expect(body1.grounding).toBe("general");
    expect(body1.generatorVersion).toBe("guided-items-v3");
    expect(body1.items.length).toBeGreaterThanOrEqual(8);
    for (const item of body1.items) {
      expect(item.answer).toBeUndefined();
    }

    const second = await app.request(path, { method: "POST", headers });
    expect(second.status).toBe(200);
    const body2 = await readJson<EnsureItemsBody>(second);
    expect(body2.items).toEqual(body1.items);

    const rows = await ctx.deps.db.select().from(topicItems).where(eq(topicItems.topicId, topic.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.schemaVersion).toBe(2);
  });

  it("GET lists stripped items after ensure", async () => {
    const { app, headers, subject, topic } = await setupUser("guided-list@example.com");
    await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`, { method: "POST", headers });

    const list = await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items`, { headers });
    expect(list.status).toBe(200);
    const body = await readJson<EnsureItemsBody>(list);
    expect(body.items.length).toBeGreaterThanOrEqual(8);
    expect(body.items.every((i) => i.answer === undefined)).toBe(true);
  });

  it("GET is read-only and 404s when items were never ensured", async () => {
    const { app, headers, subject, topic } = await setupUser("guided-get-404@example.com");
    const spy = vi.spyOn(ctx.deps.models.structuredAdapter, "generateStructured");
    const missing = await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items`, { headers });
    expect(missing.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it("uses Fuentes context and reports sources grounding", async () => {
    const { app, headers, subject, topic } = await setupUser("guided-sources@example.com");
    const fuente = await app.request(`/v1/fuentes/${subject.id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Guía de cinemática",
        kind: "pdf",
        text: "La velocidad media es desplazamiento dividido entre tiempo.",
      }),
    });
    expect(fuente.status).toBe(201);

    const response = await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`, {
      method: "POST",
      headers,
    });
    const body = await readJson<EnsureItemsBody>(response);
    expect(body.degraded).toBe(false);
    expect(body.grounding).toBe("sources");
    const [row] = await ctx.deps.db.select().from(topicItems).where(eq(topicItems.topicId, topic.id)).limit(1);
    const payload = parseTopicItemsPayload(row!.payload);
    expect(payload.items.some((item) => /desplazamiento dividido entre tiempo/i.test(`${item.prompt} ${item.explanation} ${item.options.join(" ")}`))).toBe(true);
  });

  it("fails closed without Fuentes when the production switch is enabled", async () => {
    const { app, headers, subject, topic } = await setupUser("guided-fail-close@example.com", {
      BUXO_GUIDED_REQUIRE_SOURCES: true,
    });
    const spy = vi.spyOn(ctx.deps.models.structuredAdapter, "generateStructured");
    const response = await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`, {
      method: "POST",
      headers,
    });
    const body = await readJson<EnsureItemsBody>(response);
    expect(body).toMatchObject({
      items: [],
      degraded: true,
      degradedReason: "sources_required",
      grounding: "general",
      generatorVersion: "guided-items-v3",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(await ctx.deps.db.select().from(topicItems)).toHaveLength(0);
    expect(await ctx.deps.db.select().from(usageQuotas)).toHaveLength(0);
  });

  it("returns degraded metadata, caches the failure for cooldown, and records cost without a fake fallback", async () => {
    let clock = new Date("2026-09-07T12:00:00Z");
    const { app, headers, subject, topic } = await setupUser("guided-model-fail@example.com", {}, () => clock);
    const spy = vi.fn(async () => ({
      ok: false as const,
      servedBy: null,
      promptVersion: null,
      costUsd: 0.004,
      error: "empty_chain",
    }));
    ctx.deps.models.structuredAdapter.generateStructured = spy;

    const first = await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`, {
      method: "POST",
      headers,
    });
    expect(await readJson<EnsureItemsBody>(first)).toMatchObject({
      items: [],
      degraded: true,
      degradedReason: "generation_failed",
      grounding: "general",
    });
    expect(await ctx.deps.db.select().from(topicItems)).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`, {
      method: "POST",
      headers,
    });
    expect((await readJson<EnsureItemsBody>(second)).degradedReason).toBe("generation_failed");
    expect(spy).toHaveBeenCalledTimes(1);

    clock = new Date(clock.getTime() + GUIDED_ITEMS_FAILURE_COOLDOWN_MS + 1);
    await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`, { method: "POST", headers });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("regenerates a schema v1 placeholder in place and remains race-safe", async () => {
    const { app, headers, userId, subject, topic } = await setupUser("guided-v1-regenerate@example.com");
    await ctx.deps.db.insert(topicItems).values({
      id: "legacy-topic-items",
      userId,
      subjectId: subject.id,
      topicId: topic.id,
      payload: {
        items: [{
          id: "legacy-item",
          type: "elige",
          difficulty: 1,
          prompt: "¿Cuál opción describe mejor el foco?",
          options: ["Tema", "Otro", "Nada", "Todo"],
          answer: 0,
          explanation: "Es el tema.",
        }],
      },
      generatedAt: new Date(0).toISOString(),
      schemaVersion: 1,
    });

    const spy = vi.spyOn(ctx.deps.models.structuredAdapter, "generateStructured");
    const path = `/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`;
    const [a, b] = await Promise.all([
      app.request(path, { method: "POST", headers }),
      app.request(path, { method: "POST", headers }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const [bodyA, bodyB] = await Promise.all([readJson<EnsureItemsBody>(a), readJson<EnsureItemsBody>(b)]);
    expect(bodyA.items).toEqual(bodyB.items);
    expect(bodyA.items.some((item) => item.id === "legacy-item")).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);

    const rows = await ctx.deps.db.select().from(topicItems).where(eq(topicItems.topicId, topic.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "legacy-topic-items", schemaVersion: 2 });
    expect(parseTopicItemsPayload(rows[0]!.payload).generatorVersion).toBe("guided-items-v3");
  });

  it("upgrades a general cache to sources and regenerates on generatorVersion bump", async () => {
    const { app, headers, userId, subject, topic } = await setupUser("guided-upgrade@example.com");
    const spy = vi.spyOn(ctx.deps.models.structuredAdapter, "generateStructured");
    const path = `/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`;

    const general = await readJson<EnsureItemsBody>(await app.request(path, { method: "POST", headers }));
    expect(general.grounding).toBe("general");
    expect(spy).toHaveBeenCalledTimes(1);

    const fuente = await app.request(`/v1/fuentes/${subject.id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Guía de cinemática",
        kind: "pdf",
        text: "La velocidad media es desplazamiento dividido entre tiempo.",
      }),
    });
    expect(fuente.status).toBe(201);
    const upgraded = await readJson<EnsureItemsBody>(await app.request(path, { method: "POST", headers }));
    expect(upgraded.grounding).toBe("sources");
    expect(spy).toHaveBeenCalledTimes(2);

    await ctx.deps.db.update(topicItems).set({
      payload: { ...parseTopicItemsPayload((await ctx.deps.db.select().from(topicItems).where(eq(topicItems.topicId, topic.id)))[0]!.payload), generatorVersion: "guided-items-v1" },
    }).where(eq(topicItems.topicId, topic.id));
    const bumped = await readJson<EnsureItemsBody>(await app.request(path, { method: "POST", headers }));
    expect(bumped.generatorVersion).toBe("guided-items-v3");
    expect(spy).toHaveBeenCalledTimes(3);
    expect(userId).toBeTruthy();
  });

  it("records guided cost on generate, not on cache hit, and rejects at the USD cap without a tutor-message increment", async () => {
    const { app, headers, userId, subject, topic } = await setupUser("guided-quota@example.com");
    const path = `/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`;
    expect((await app.request(path, { method: "POST", headers })).status).toBe(200);

    const dailies = (await ctx.deps.db.select().from(usageQuotas).where(eq(usageQuotas.userId, userId))).filter((row) => row.period === "daily");
    const daily = dailies[0];
    expect(daily).toBeDefined();
    expect(daily!.tutorMessagesUsed).toBe(0);
    expect(daily!.costUsdEstimate ?? 0).toBeGreaterThan(0);
    const costAfterFirst = daily!.costUsdEstimate ?? 0;

    expect((await app.request(path, { method: "POST", headers })).status).toBe(200);
    const [dailyHit] = await ctx.deps.db.select().from(usageQuotas).where(eq(usageQuotas.id, daily!.id));
    expect(dailyHit!.costUsdEstimate).toBe(costAfterFirst);
    expect(dailyHit!.tutorMessagesUsed).toBe(0);

    await recordUsage(ctx.deps.db, daily!.id, "guided_items", 10);
    const monthly = (await ctx.deps.db.select().from(usageQuotas).where(eq(usageQuotas.userId, userId))).find((row) => row.period === "monthly");
    if (monthly) await recordUsage(ctx.deps.db, monthly.id, "guided_items", 10);

    const spy = vi.spyOn(ctx.deps.models.structuredAdapter, "generateStructured");
    const otherTopic = await readJson<TopicBody>(
      await app.request(`/v1/temario/${subject.id}/topics`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Caída libre" }),
      }),
    );
    const blocked = await app.request(`/v1/subjects/${subject.id}/topics/${otherTopic.id}/items:ensure`, {
      method: "POST",
      headers,
    });
    expect(blocked.status).toBe(429);
    expect((await readJson<{ code: string }>(blocked)).code).toBe("quota_exceeded");
    expect(spy).not.toHaveBeenCalled();
    const rejections = await ctx.deps.db.select().from(quotaRejections).where(eq(quotaRejections.userId, userId));
    expect(rejections.some((row) => row.surface === "guided_items" && row.reason === "cost_cap")).toBe(true);
  });

  it("returns 404 for another user's subject", async () => {
    const owner = await setupUser("guided-owner@example.com");
    const other = await setupUser("guided-other@example.com");

    const res = await other.app.request(
      `/v1/subjects/${owner.subject.id}/topics/${owner.topic.id}/items:ensure`,
      { method: "POST", headers: other.headers },
    );
    expect(res.status).toBe(404);
  });

  it("awards XP on correct first try and retry", async () => {
    const { app, headers, subject, topic } = await setupUser("guided-answer@example.com");
    await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`, { method: "POST", headers });

    const [row] = await ctx.deps.db
      .select()
      .from(topicItems)
      .where(eq(topicItems.topicId, topic.id))
      .limit(1);
    const payload = parseTopicItemsPayload(row!.payload);
    const quiz = payload.items.find((i) => i.type === "elige" && typeof i.answer === "number");
    expect(quiz).toBeDefined();

    const wrongIdx = quiz!.options.findIndex((_, idx) => idx !== quiz!.answer);
    const wrong = await readJson<{ correct: boolean; xpDelta: number; explanation: string }>(
      await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items/${quiz!.id}/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ selected: wrongIdx, attempt: 1, responseMs: 1200 }),
      }),
    );
    expect(wrong.correct).toBe(false);
    expect(wrong.xpDelta).toBe(0);

    const retry = await readJson<{ correct: boolean; xpDelta: number }>(
      await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items/${quiz!.id}/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ selected: quiz!.answer, attempt: 2, responseMs: 800 }),
      }),
    );
    expect(retry.correct).toBe(true);
    expect(retry.xpDelta).toBe(XP_GUIDED_RETRY);

    const vf = payload.items.find((i) => i.type === "verdadero_falso");
    expect(vf).toBeDefined();
    const firstTry = await readJson<{ correct: boolean; xpDelta: number }>(
      await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items/${vf!.id}/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ selected: vf!.answer, attempt: 1, responseMs: 500 }),
      }),
    );
    expect(firstTry.correct).toBe(true);
    expect(firstTry.xpDelta).toBe(XP_GUIDED_CORRECT);
  });

  it("grades elige when client sends option label text (mobile)", async () => {
    const { app, headers, subject, topic } = await setupUser("guided-label@example.com");
    await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`, { method: "POST", headers });

    const [row] = await ctx.deps.db
      .select()
      .from(topicItems)
      .where(eq(topicItems.topicId, topic.id))
      .limit(1);
    const payload = parseTopicItemsPayload(row!.payload);
    const quiz = payload.items.find((i) => i.type === "elige" && typeof i.answer === "number");
    expect(quiz).toBeDefined();
    const label = quiz!.options[quiz!.answer as number];
    expect(label).toBeTruthy();

    const res = await readJson<{ correct: boolean; xpDelta: number }>(
      await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/items/${quiz!.id}/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ selected: label, attempt: 1, responseMs: 400 }),
      }),
    );
    expect(res.correct).toBe(true);
    expect(res.xpDelta).toBe(XP_GUIDED_CORRECT);
  });

  it("guided:complete is idempotent", async () => {
    const { app, headers, subject, topic } = await setupUser("guided-complete@example.com");

    const first = await readJson<{ xpDelta: number }>(
      await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/guided:complete`, { method: "POST", headers }),
    );
    expect(first.xpDelta).toBe(XP_GUIDED_SESSION);

    const second = await readJson<{ xpDelta: number }>(
      await app.request(`/v1/subjects/${subject.id}/topics/${topic.id}/guided:complete`, { method: "POST", headers }),
    );
    expect(second.xpDelta).toBe(0);
  });
});
