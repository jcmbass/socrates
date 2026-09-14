/**
 * plan-modal-rag F0.1 — insert failure must not break the tutor turn.
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

import { eq } from "drizzle-orm";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody, SessionBody, FullSessionBody } from "../support/http-types";
import { fuentesContextMetrics } from "../../src/db/schema";
import * as metricsRepo from "../../src/repositories/fuentes-context-metrics";
import { createFuente } from "../../src/repositories/fuentes";

function tutorStreamResult(text: string) {
  return {
    usage: Promise.resolve({
      inputTokens: 500,
      outputTokens: 100,
      inputTokenDetails: { noCacheTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
    text: Promise.resolve(text),
    toTextStreamResponse: () => new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } }),
  };
}

function assessorObject() {
  return {
    demonstratedUnderstanding: "developing",
    explainedInOwnWords: true,
    guessedOrPatternMatched: false,
    recommendedBand: "probing",
    rationale: "ok",
  };
}

function usage(inputTokens = 200, outputTokens = 50) {
  return { inputTokens, outputTokens, inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 60));

describe("POST /exchanges — F0.1 fuentes_context_metrics", () => {
  let ctx: TestContext;

  beforeEach(() => {
    streamTextMock.mockReset();
    generateObjectMock.mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await ctx?.testDb.close();
  });

  async function setupWithFuente() {
    ctx = await buildTestDeps({ envOverrides: { JUDGE_SAMPLE_RATE: 0 } });
    const app = createApp(ctx.deps);
    const email = `f0persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const { token, userId } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Cálculo I" }) }),
    );
    await createFuente(ctx.testDb.db, {
      userId,
      subjectId: subject.id,
      name: "Guía.pdf",
      kind: "pdf",
      text: "La derivada de x^2 es 2x.",
    });
    const session = await readJson<SessionBody>(
      await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id }) }),
    );
    return { app, headers, session, subjectId: subject.id };
  }

  it("persists one metrics row per context build (builder=topic)", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("¿Qué observás?"));
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const { app, headers, session, subjectId } = await setupWithFuente();
    const res = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "la derivada es 2x" }),
    });
    expect(res.status).toBe(200);
    await flush();

    const rows = await ctx.testDb.db
      .select()
      .from(fuentesContextMetrics)
      .where(eq(fuentesContextMetrics.sessionId, session.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subjectId,
      sessionId: session.id,
      kind: "topic",
      builder: "topic",
      truncated: false,
      droppedTokens: 0,
    });
    expect(rows[0].fuenteCount).toBeGreaterThanOrEqual(1);
    expect(rows[0].corpusTokens).toBeGreaterThan(0);
    expect(JSON.stringify(rows[0])).not.toMatch(/derivada|Guía\.pdf/i);
  });

  it("insert failure does NOT break the turn (invariant)", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("¿Qué observás?"));
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const spy = vi.spyOn(metricsRepo, "recordFuentesContextMetrics").mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { app, headers, session } = await setupWithFuente();
    const res = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "la derivada es 2x" }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("¿Qué observás?");
    await flush();

    expect(spy).toHaveBeenCalled();
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes("fuentes_context_metrics persist failed"))).toBe(true);

    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges).toHaveLength(1);
  });
});
