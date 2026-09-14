/**
 * Route-level tests for XP read routes — Fase P1 antifuga + policy.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody } from "../support/http-types";
import { createXpEvent } from "../../src/repositories/xp";

describe("GET /v1/xp/:subjectId — P1 antifuga + demotion policy", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function authedApp(email: string, options?: Parameters<typeof buildTestDeps>[0]) {
    ctx = await buildTestDeps(options);
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Matemática" }) }),
    );
    return { app, token, userId, headers, subject };
  }

  it("omits numeric XP and ledger from the payload in shadow mode (antifuga)", async () => {
    const { app, headers, userId, subject } = await authedApp("xp-shadow@example.com");
    await createXpEvent(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      delta: 100,
      reason: "tier_promoted",
      assessmentRef: { assessmentId: "a1", sessionId: "s1" },
    });

    const res = await app.request(`/v1/xp/${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<Record<string, unknown>>(res);
    expect(body).not.toHaveProperty("raw");
    expect(body).not.toHaveProperty("visible");
    expect(body).not.toHaveProperty("events");
    expect(body).toHaveProperty("policy");
  });

  it("exposes raw/visible/event totals in visible mode", async () => {
    const { app, headers, userId, subject } = await authedApp("xp-visible@example.com", {
      envOverrides: { MASTERY_VISIBILITY_MODE: "visible" },
    });
    await createXpEvent(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      delta: 100,
      reason: "tier_promoted",
      assessmentRef: { assessmentId: "a1", sessionId: "s1" },
    });

    const res = await app.request(`/v1/xp/${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<Record<string, unknown>>(res);
    expect(body.raw).toBe(100);
    expect(body.visible).toBe(100);
    expect(body.events).toHaveLength(1);
  });

  it("P4: bare /v1/xp (no subjectId) totals XP across every subject of the user", async () => {
    const { app, headers, userId, subject } = await authedApp("xp-total-user@example.com", {
      envOverrides: { MASTERY_VISIBILITY_MODE: "visible" },
    });
    await createXpEvent(ctx.deps.db, { userId, subjectId: subject.id, delta: 40, reason: "tier_promoted", assessmentRef: { assessmentId: "a1", sessionId: "s1" } });

    const res = await app.request("/v1/xp", { headers });
    expect(res.status).toBe(200);
    const body = await readJson<Record<string, unknown>>(res);
    expect(body.raw).toBe(40);
    expect(body.visible).toBe(40);
    expect(body.subjectId).toBeNull();
  });

  it("honors the BUXO_XP_DEMOTION_POLICY env flag", async () => {
    const { app, headers, userId, subject } = await authedApp("xp-policy@example.com", {
      envOverrides: { MASTERY_VISIBILITY_MODE: "visible", BUXO_XP_DEMOTION_POLICY: "floor" },
    });
    await createXpEvent(ctx.deps.db, { userId, subjectId: subject.id, delta: 100, reason: "tier_promoted", assessmentRef: { assessmentId: "a", sessionId: "s" } });
    await createXpEvent(ctx.deps.db, { userId, subjectId: subject.id, delta: -150, reason: "tier_demoted", assessmentRef: { assessmentId: "b", sessionId: "s" } });

    const res = await app.request(`/v1/xp/${subject.id}`, { headers });
    const body = await readJson<Record<string, unknown>>(res);
    expect(body.raw).toBe(-50);
    expect(body.visible).toBe(0);
    expect(body.policy).toBe("floor");
  });
});
