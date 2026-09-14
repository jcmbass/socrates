/**
 * HTTP-boundary wiring test for B2-motor-de-dominio.md §9.4 — proves
 * `POST /:id/exchanges` (routes/sessions.ts) actually calls
 * `applyAssessmentToMastery` after `recordAssessment`, not just that the
 * service function works in isolation (`__tests__/mastery/aggregate.test.ts`
 * already covers that). Same "ai" mocking pattern as
 * `__tests__/routes/sessions-happy.test.ts`. Mastery has no public read
 * route yet in F2 scope beyond the founder-only inspect endpoint (parte
 * B4) — this test reads `ctx.deps.db` directly via the repository, same as
 * any other server-internal assertion would.
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
import { findMasteryState } from "../../src/repositories/mastery";
import { SUBJECT_ROLLUP_TOPIC_KEY } from "@buxo/domain/sentinels";
import type { CourseBody, SubjectBody, SessionBody } from "../support/http-types";

function tutorStreamResult(text: string) {
  return {
    usage: Promise.resolve({ inputTokens: 200, outputTokens: 50, inputTokenDetails: { noCacheTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
    text: Promise.resolve(text),
    toTextStreamResponse: () => new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } }),
  };
}

function positiveAssessorObject(topicKey: string | null = "Fracciones equivalentes") {
  return {
    demonstratedUnderstanding: "developing",
    explainedInOwnWords: true,
    guessedOrPatternMatched: false,
    recommendedBand: "probing",
    rationale: "El estudiante explicó el paso con sus propias palabras.",
    topicKey,
  };
}

function usage() {
  return { inputTokens: 200, outputTokens: 50, inputTokenDetails: { noCacheTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("POST /v1/sessions/:id/exchanges — mastery aggregation wiring (F2 WQ3 parte B3)", () => {
  let ctx: TestContext;

  beforeEach(() => {
    streamTextMock.mockReset();
    generateObjectMock.mockReset();
  });

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setupSession() {
    ctx = await buildTestDeps({ envOverrides: { JUDGE_SAMPLE_RATE: 0 } });
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "mastery-wiring@example.com");
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

    return { app, headers, session, subject, userId };
  }

  it("3 exchanges with positive assessor verdicts promote the rollup MasteryState emerging -> developing, shadow visibility", async () => {
    const { app, headers, session, subject, userId } = await setupSession();

    for (let i = 0; i < 3; i++) {
      streamTextMock.mockReturnValue(tutorStreamResult(`Respuesta ${i}`));
      // Diseño de dos modelos (2026-08-11): cada exchange hace DOS llamadas
      // de assessor — banda (cada turno) + mastery (muestreado, rate=1 en
      // tests). Ambas devuelven el veredicto positivo.
      generateObjectMock.mockResolvedValueOnce({ object: positiveAssessorObject(), usage: usage() });
      generateObjectMock.mockResolvedValueOnce({ object: positiveAssessorObject(), usage: usage() });

      const res = await app.request(`/v1/sessions/${session.id}/exchanges`, {
        method: "POST",
        headers,
        body: JSON.stringify({ studentMessage: `mensaje ${i}` }),
      });
      expect(res.status).toBe(200);
      await flush();
    }

    const rollup = await findMasteryState(ctx.deps.db, userId, subject.id, SUBJECT_ROLLUP_TOPIC_KEY);
    expect(rollup).not.toBeNull();
    expect(rollup!.currentLevel.tier).toBe("developing");
    expect(rollup!.visibility).toBe("shadow"); // default MASTERY_VISIBILITY_MODE
  });

  it("a real request never fails when mastery aggregation would (degrade-to-log, never break the stream)", async () => {
    const { app, headers, session } = await setupSession();

    streamTextMock.mockReturnValue(tutorStreamResult("Seguí, ¿qué observás?"));
    // No topicKey field on this canned object at all (malformed shape from the model's perspective) — the fake structured
    // adapter mock doesn't validate against assessorSchema, so this exercises whatever downstream tolerance exists.
    generateObjectMock.mockResolvedValueOnce({
      object: { demonstratedUnderstanding: "developing", explainedInOwnWords: true, guessedOrPatternMatched: false, recommendedBand: "probing", rationale: "ok" },
      usage: usage(),
    });

    const res = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "no sé" }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Seguí, ¿qué observás?");
    await flush();
  });
});
