/**
 * POST /v1/sessions/:id/exchanges — turn idempotency (beta-real 10).
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 40));

describe("POST /v1/sessions/:id/exchanges — idempotency (beta-real 10)", () => {
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
    const { token } = await signupAndVerify(app, ctx.deps, "idempotency@example.com");
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

    return { app, headers, session };
  }

  it("two POSTs with the same clientMessageId produce one Exchange (second after done → 409)", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("¿Qué observás?"));
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const { app, headers, session } = await setupSession();
    const body = JSON.stringify({ studentMessage: "la derivada es 2x", clientMessageId: "cm-same-1" });

    const first = await app.request(`/v1/sessions/${session.id}/exchanges`, { method: "POST", headers, body });
    expect(first.status).toBe(200);
    await flush();

    const second = await app.request(`/v1/sessions/${session.id}/exchanges`, { method: "POST", headers, body });
    expect(second.status).toBe(409);
    const errBody = (await second.json()) as { code: string };
    expect(errBody.code).toBe("duplicate_turn");

    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges).toHaveLength(1);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });

  it("duplicate arriving while the first is still in flight → 409 and still one Exchange", async () => {
    let resolveText!: (value: string) => void;
    const textPromise = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    streamTextMock.mockReturnValue({
      usage: Promise.resolve({
        inputTokens: 10,
        outputTokens: 5,
        inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
      text: textPromise,
      toTextStreamResponse: () => new Response("parcial", { headers: { "content-type": "text/plain; charset=utf-8" } }),
    });
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const { app, headers, session } = await setupSession();
    const body = JSON.stringify({ studentMessage: "no entiendo", clientMessageId: "cm-inflight" });

    const firstPromise = app.request(`/v1/sessions/${session.id}/exchanges`, { method: "POST", headers, body });
    // Let the first request claim + start streaming before the duplicate arrives.
    await flush();

    const dup = await app.request(`/v1/sessions/${session.id}/exchanges`, { method: "POST", headers, body });
    expect(dup.status).toBe(409);
    const dupBody = (await dup.json()) as { code: string };
    expect(dupBody.code).toBe("duplicate_turn");

    resolveText("respuesta completa");
    const first = await firstPromise;
    expect(first.status).toBe(200);
    await flush();

    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges).toHaveLength(1);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });

  it("same text with distinct clientMessageIds → two Exchanges", async () => {
    streamTextMock
      .mockReturnValueOnce(tutorStreamResult("primera"))
      .mockReturnValueOnce(tutorStreamResult("segunda"));
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const { app, headers, session } = await setupSession();
    const msg = "no entiendo";

    const a = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: msg, clientMessageId: "cm-a" }),
    });
    expect(a.status).toBe(200);
    await flush();

    const b = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: msg, clientMessageId: "cm-b" }),
    });
    expect(b.status).toBe(200);
    await flush();

    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges).toHaveLength(2);
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it("without clientMessageId keeps pre-idempotency behaviour (no 400)", async () => {
    streamTextMock
      .mockReturnValueOnce(tutorStreamResult("uno"))
      .mockReturnValueOnce(tutorStreamResult("dos"));
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const { app, headers, session } = await setupSession();
    const body = JSON.stringify({ studentMessage: "hola" });

    expect((await app.request(`/v1/sessions/${session.id}/exchanges`, { method: "POST", headers, body })).status).toBe(200);
    await flush();
    expect((await app.request(`/v1/sessions/${session.id}/exchanges`, { method: "POST", headers, body })).status).toBe(200);
    await flush();

    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges).toHaveLength(2);
  });
});
