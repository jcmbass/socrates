/**
 * Quota enforcement end-to-end (§2.5) — under/at/over the daily cap, via
 * the real HTTP route (not just the repository unit). Uses a FAKE model
 * provider (same pattern as sessions-happy.test.ts) since the tutor is
 * called on every non-blocked message before the cap is hit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { streamTextMock, generateObjectMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  generateObjectMock: vi.fn(),
}));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: streamTextMock, generateObject: generateObjectMock };
});

import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody, SessionBody } from "../support/http-types";

function tutorStreamResult(text: string) {
  return {
    usage: Promise.resolve({ inputTokens: 100, outputTokens: 20, inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
    text: Promise.resolve(text),
    toTextStreamResponse: () => new Response(text),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("§2.5 quota enforcement — under/at/over the daily tutor-message cap", () => {
  let ctx: TestContext;

  beforeEach(() => {
    streamTextMock.mockReset();
    streamTextMock.mockReturnValue(tutorStreamResult("¿Qué probaste primero?"));
    generateObjectMock.mockReset();
    generateObjectMock.mockRejectedValue(new Error("no structured output needed for this test")); // assessor degrades to null; irrelevant here
  });

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("allows messages under the cap, blocks with quota_exceeded at the cap, and a fresh day resets it", async () => {
    // QUOTA_DAILY_TUTOR_MESSAGES defaults to 3 in the test env (see support/test-deps.ts).
    let clock = new Date("2026-07-12T15:00:00Z"); // El Salvador afternoon, well inside one daily period.
    ctx = await buildTestDeps({ now: () => clock });
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "quota@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }));
    const subject = await readJson<SubjectBody>(await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Química" }) }));
    const session = await readJson<SessionBody>(await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id }) }));

    // 3 messages allowed (cap = 3).
    for (let i = 0; i < 3; i++) {
      const res = await app.request(`/v1/sessions/${session.id}/exchanges`, {
        method: "POST",
        headers,
        body: JSON.stringify({ studentMessage: `mensaje ${i}` }),
      });
      expect(res.status).toBe(200);
      await flush();
    }

    // 4th message, same day -> blocked.
    const blocked = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "mensaje 4" }),
    });
    expect(blocked.status).toBe(429);
    const body = await readJson<{ code: string }>(blocked);
    expect(body.code).toBe("quota_exceeded");

    // Next El Salvador day -> quota resets, message allowed again.
    clock = new Date("2026-07-13T15:00:00Z");
    const nextDay = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "mensaje del día siguiente" }),
    });
    expect(nextDay.status).toBe(200);
  });

  it("internal_dev accounts are exempt from quota (B3 §2.1)", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { userId, token } = await signupAndVerify(app, ctx.deps, "dev-account@example.com");

    // Promote to internal_dev directly via the repository (no public endpoint sets this — founder/ops-only in a real deploy).
    const { users } = await import("../../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await ctx.deps.db.update(users).set({ accountKind: "internal_dev" }).where(eq(users.id, userId));

    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }));
    const subject = await readJson<SubjectBody>(await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Historia" }) }));
    const session = await readJson<SessionBody>(await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id }) }));

    // Cap is 3 in the test env — send 5, all must succeed.
    for (let i = 0; i < 5; i++) {
      const res = await app.request(`/v1/sessions/${session.id}/exchanges`, {
        method: "POST",
        headers,
        body: JSON.stringify({ studentMessage: `mensaje ${i}` }),
      });
      expect(res.status).toBe(200);
      await flush();
    }
  });
});
