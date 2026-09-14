/**
 * Full tutor turn against a FAKE model provider — never the real SDK
 * provider. Follows the exact pattern already validated in
 * packages/models/__tests__/*-adapter.test.ts: mock `streamText`/
 * `generateObject` from `"ai"`, inject a trivial fake `ProviderResolver`
 * (__tests__/support/fake-provider.ts) via `createModelAdapters` — the
 * SAME wiring `src/models/adapters.ts` builds in prod, just fed fakes.
 * Zero real network calls.
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
import type { CourseBody, SubjectBody, SessionBody, FullSessionBody } from "../support/http-types";

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

function assessorObject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    demonstratedUnderstanding: "developing",
    explainedInOwnWords: true,
    guessedOrPatternMatched: false,
    recommendedBand: "probing",
    rationale: "El estudiante explicó el paso con sus propias palabras.",
    ...overrides,
  };
}

function judgeObject(overrides: Partial<Record<string, unknown>> = {}) {
  return { hint_offered: true, student_correct: true, ...overrides };
}

function usage(inputTokens = 200, outputTokens = 50) {
  return { inputTokens, outputTokens, inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("POST /v1/sessions/:id/exchanges — full turn against a fake model provider", () => {
  let ctx: TestContext;

  beforeEach(() => {
    streamTextMock.mockReset();
    generateObjectMock.mockReset();
  });

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setupSession(overrides: Parameters<typeof buildTestDeps>[0] = {}) {
    ctx = await buildTestDeps(overrides);
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "tutor-flow@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Cálculo I" }) }),
    );
    const session = await readJson<SessionBody>(
      await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id }) }),
    );

    return { app, headers, session, subject };
  }

  it("streams the tutor reply, then persists the Exchange + assessor verdict + band change (I-12)", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("¿Qué observás sobre la pendiente en ese punto?"));
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const { app, headers, session } = await setupSession({ envOverrides: { JUDGE_SAMPLE_RATE: 0 } });

    const res = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "Creo que la derivada es 2x" }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("¿Qué observás sobre la pendiente en ese punto?");

    await flush();

    const getRes = await app.request(`/v1/sessions/${session.id}`, { headers });
    const full = await readJson<FullSessionBody>(getRes);
    expect(full.exchanges).toHaveLength(1);
    expect(full.exchanges[0]).toMatchObject({
      studentMessage: "Creo que la derivada es 2x",
      tutorReply: "¿Qué observás sobre la pendiente en ese punto?",
      tutorProviderId: "anthropic",
      tutorModelId: "claude-sonnet-5",
      band: "guiding",
    });
    // Assessor recommended "probing" with explainedInOwnWords + not guessed -> band moves one step.
    expect(full.bandChanges.at(-1)).toMatchObject({ band: "probing", source: "auto" });
  });

  it("samples the judge when random() < judgeSampleRate and backfills hint_offered/student_correct", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("Seguí, ¿qué regla aplicarías?"));
    generateObjectMock
      .mockResolvedValueOnce({ object: assessorObject({ recommendedBand: "guiding" }), usage: usage() })
      .mockResolvedValueOnce({ object: judgeObject(), usage: usage() });

    // MASTERY_ASSESSOR_SAMPLE_RATE: 0 — este test prueba el judge, no el
    // mastery (diseño de dos modelos: el random inyectado controlaría ambos).
    const { app, headers, session } = await setupSession({ envOverrides: { JUDGE_SAMPLE_RATE: 1, MASTERY_ASSESSOR_SAMPLE_RATE: 0 }, random: () => 0 });

    await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "no sé, ¿la regla de la cadena?" }),
    });
    await flush();

    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges[0].hintOffered).toBe(true);
    expect(full.exchanges[0].studentCorrect).toBe(true);
    expect(full.exchanges[0].judgeModelId).toBe("claude-sonnet-5");
  });

  it("does NOT call the judge when random() >= judgeSampleRate", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("¿Qué pasa si derivás término a término?"));
    generateObjectMock.mockResolvedValueOnce({ object: assessorObject({ recommendedBand: "guiding" }), usage: usage() });

    // MASTERY_ASSESSOR_SAMPLE_RATE: 0 — este test prueba el judge, no el
    // mastery (diseño de dos modelos: el random inyectado controlaría ambos).
    const { app, headers, session } = await setupSession({ envOverrides: { JUDGE_SAMPLE_RATE: 0.5, MASTERY_ASSESSOR_SAMPLE_RATE: 0 }, random: () => 0.9 });

    await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "mmm no estoy seguro" }),
    });
    await flush();

    expect(generateObjectMock).toHaveBeenCalledTimes(1); // assessor only, no judge
  });

  it("degrades gracefully to a null assessor verdict without ever failing the tutor response (degrade-to-null contract)", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("Contame más sobre tu razonamiento."));
    generateObjectMock.mockRejectedValue(new Error("upstream 500"));

    const { app, headers, session } = await setupSession();

    const res = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "algo" }),
    });
    expect(res.status).toBe(200);
    await flush();

    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges).toHaveLength(1); // Exchange still persisted — only the assessor verdict is null
    expect(full.bandChanges).toHaveLength(1); // no auto band change from a null verdict
  });
});
