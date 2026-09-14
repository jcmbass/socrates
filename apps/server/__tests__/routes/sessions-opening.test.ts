/**
 * POST /v1/sessions/:id/opening — proactive tutor opening, idempotent,
 * never a synthetic Exchange.studentMessage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEVER_DIRECT_ANSWER, SESSION_OPENING_USER_INSTRUCTION } from "@buxo/core/prompts";
import { exchanges } from "../../src/db/schema";
import { eq } from "drizzle-orm";

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

interface TopicBody {
  id: string;
  title: string;
  order: number;
}
interface FuenteBody {
  id: string;
  name: string;
}
interface OpeningBody {
  id: string;
  sessionId: string;
  text: string;
  tutorModelId: string;
  tutorProviderId: string;
  tutorPromptVersion: string;
  grounding: "fuentes" | "general";
}

function tutorStreamResult(text: string) {
  return {
    usage: Promise.resolve({
      inputTokens: 400,
      outputTokens: 80,
      inputTokenDetails: { noCacheTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
    text: Promise.resolve(text),
    toTextStreamResponse: () => new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } }),
  };
}

function systemContentOf(call: { system: string | { content: string } }): string {
  return typeof call.system === "string" ? call.system : call.system.content;
}

const OPENING_TEXT =
  "Una idea breve: la pendiente mide cómo cambia y con x. ¿Qué pasa con el incremento en y si duplicás el de x?";

describe("POST /v1/sessions/:id/opening", () => {
  let ctx: TestContext;

  beforeEach(() => {
    streamTextMock.mockReset();
    generateObjectMock.mockReset();
  });

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setupTopicSession(email: string, opts?: { withFuente?: boolean }) {
    ctx = await buildTestDeps({ envOverrides: { JUDGE_SAMPLE_RATE: 0 } });
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Física 1" }) }),
    );
    const topic = await readJson<TopicBody>(
      await app.request(`/v1/temario/${subject.id}/topics`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Movimiento rectilíneo" }),
      }),
    );
    if (opts?.withFuente) {
      await readJson<FuenteBody>(
        await app.request(`/v1/fuentes/${subject.id}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: "Guía de cinemática.pdf",
            kind: "pdf",
            text: "La velocidad media es el desplazamiento dividido por el tiempo transcurrido.",
          }),
        }),
      );
    }
    const session = await readJson<SessionBody>(
      await app.request("/v1/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify({ subjectId: subject.id, topicId: topic.id }),
      }),
    );
    return { app, headers, session, subject, topic, userId };
  }

  it("generates a grounded opening, persists model/provider/prompt/grounding, and creates zero exchanges", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult(OPENING_TEXT));

    const { app, headers, session } = await setupTopicSession("opening-fuentes@example.com", { withFuente: true });
    const res = await app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers });
    expect(res.status).toBe(200);
    const opening = await readJson<OpeningBody>(res);
    expect(opening.text).toBe(OPENING_TEXT);
    expect(opening.sessionId).toBe(session.id);
    expect(opening.grounding).toBe("fuentes");
    expect(opening.tutorModelId).toBeTruthy();
    expect(opening.tutorProviderId).toBeTruthy();
    expect(opening.tutorPromptVersion).toBeTruthy();

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const call = streamTextMock.mock.calls[0]![0] as {
      system: string | { content: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(systemContentOf(call)).toContain(NEVER_DIRECT_ANSWER);
    expect(systemContentOf(call)).toContain("Tema actual: Movimiento rectilíneo");
    expect(systemContentOf(call)).toContain("Guía de cinemática.pdf");
    expect(systemContentOf(call)).toContain("velocidad media");
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0]?.role).toBe("user");
    expect(call.messages[0]?.content).toBe(SESSION_OPENING_USER_INSTRUCTION);

    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges).toHaveLength(0);
    expect(full.opening?.text).toBe(OPENING_TEXT);
    expect(full.opening?.grounding).toBe("fuentes");

    const exchangeRows = await ctx.deps.db.select().from(exchanges).where(eq(exchanges.sessionId, session.id));
    expect(exchangeRows).toHaveLength(0);
    expect(exchangeRows.some((row) => row.studentMessage.length > 0)).toBe(false);
  });

  it("grounds as general when the subject has no Fuentes", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult(OPENING_TEXT));

    const { app, headers, session } = await setupTopicSession("opening-general@example.com");
    const opening = await readJson<OpeningBody>(
      await app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers }),
    );
    expect(opening.grounding).toBe("general");

    const call = streamTextMock.mock.calls[0]![0] as { system: string | { content: string } };
    expect(systemContentOf(call)).toContain("Tema actual: Movimiento rectilíneo");
    expect(systemContentOf(call)).not.toContain("Guía de cinemática.pdf");
  });

  it("is idempotent: a retry returns the same opening and does not call the model again", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult(OPENING_TEXT));

    const { app, headers, session } = await setupTopicSession("opening-idempotent@example.com", { withFuente: true });
    const first = await readJson<OpeningBody>(
      await app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers }),
    );
    const second = await readJson<OpeningBody>(
      await app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers }),
    );
    expect(second).toEqual(first);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });

  it("404s for another user's session (ownership)", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult(OPENING_TEXT));
    const { app, session } = await setupTopicSession("opening-owner@example.com");

    const { token: otherToken } = await signupAndVerify(app, ctx.deps, "opening-intruder@example.com");
    const res = await app.request(`/v1/sessions/${session.id}/opening`, {
      method: "POST",
      headers: { authorization: `Bearer ${otherToken}`, "content-type": "application/json" },
    });
    expect(res.status).toBe(404);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("409s when the session already has exchanges", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("¿Qué observás?"));
    generateObjectMock.mockResolvedValue({
      object: {
        demonstratedUnderstanding: "developing",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
        recommendedBand: "guiding",
        rationale: "x",
      },
      usage: { inputTokens: 50, outputTokens: 10 },
    });

    const { app, headers, session } = await setupTopicSession("opening-has-exchanges@example.com");
    const exchangeRes = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "no entiendo la velocidad media" }),
    });
    expect(exchangeRes.status).toBe(200);
    streamTextMock.mockClear();

    const res = await app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers });
    expect(res.status).toBe(409);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("409s on a milestone session", async () => {
    ctx = await buildTestDeps({ envOverrides: { JUDGE_SAMPLE_RATE: 0 } });
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "opening-milestone@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Física 1" }) }),
    );
    const topic = await readJson<TopicBody>(
      await app.request(`/v1/temario/${subject.id}/topics`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Cinemática" }),
      }),
    );
    const milestone = await readJson<{ id: string }>(
      await app.request(`/v1/temario/${subject.id}/milestones`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "parcial", title: "Parcial 1", coversUpToOrder: topic.order }),
      }),
    );
    const session = await readJson<SessionBody>(
      await app.request("/v1/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify({ subjectId: subject.id, milestoneId: milestone.id }),
      }),
    );

    const res = await app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers });
    expect(res.status).toBe(409);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("injects the persisted opening as the first assistant message on POST /exchanges", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult(OPENING_TEXT));
    generateObjectMock.mockResolvedValue({
      object: {
        demonstratedUnderstanding: "developing",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
        recommendedBand: "guiding",
        rationale: "x",
      },
      usage: { inputTokens: 50, outputTokens: 10 },
    });

    const { app, headers, session } = await setupTopicSession("opening-in-history@example.com");
    expect((await app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers })).status).toBe(200);
    streamTextMock.mockClear();
    streamTextMock.mockReturnValue(tutorStreamResult("¿Cómo lo conectarías con la velocidad media?"));

    const exchangeRes = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "si duplico x, y también" }),
    });
    expect(exchangeRes.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const call = streamTextMock.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.messages[0]?.role).toBe("assistant");
    expect(call.messages[0]?.content).toBe(OPENING_TEXT);
    const last = call.messages[call.messages.length - 1];
    expect(last?.role).toBe("user");
    expect(last?.content).toBe("si duplico x, y también");
    expect(call.messages.some((m) => m.role === "user" && m.content === SESSION_OPENING_USER_INSTRUCTION)).toBe(
      false,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  it("409s when the session is not active", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult(OPENING_TEXT));
    const { app, headers, session } = await setupTopicSession("opening-inactive@example.com");
    const { closeStudySession } = await import("../../src/repositories/study-sessions");
    await closeStudySession(ctx.deps.db, session.id, "completed");

    const res = await app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers });
    expect(res.status).toBe(409);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("429s when tutor quota is already exhausted", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult(OPENING_TEXT));
    ctx = await buildTestDeps({ envOverrides: { JUDGE_SAMPLE_RATE: 0, QUOTA_DAILY_TUTOR_MESSAGES: 0 } });
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "opening-quota@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Física 1" }) }),
    );
    const topic = await readJson<TopicBody>(
      await app.request(`/v1/temario/${subject.id}/topics`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Movimiento rectilíneo" }),
      }),
    );
    const session = await readJson<SessionBody>(
      await app.request("/v1/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify({ subjectId: subject.id, topicId: topic.id }),
      }),
    );

    const res = await app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers });
    expect(res.status).toBe(429);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("quota_exceeded");
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("records tutor quota usage only once across concurrent first POSTs", async () => {
    let release: ((text: string) => void) | undefined;
    let calls = 0;
    streamTextMock.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return {
          usage: Promise.resolve({
            inputTokens: 400,
            outputTokens: 80,
            inputTokenDetails: { noCacheTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 },
          }),
          text: new Promise<string>((resolve) => {
            release = resolve;
          }),
          toTextStreamResponse: () => new Response("pending"),
        };
      }
      throw new Error("concurrent opener must not call the model a second time");
    });

    const { app, headers, session, userId } = await setupTopicSession("opening-concurrent@example.com");
    const p1 = app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers });
    const p2 = app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers });
    await vi.waitFor(() => {
      expect(calls).toBe(1);
      expect(release).toBeDefined();
    });
    release!(OPENING_TEXT);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const bodyA = await readJson<OpeningBody>(a);
    const bodyB = await readJson<OpeningBody>(b);
    expect(bodyB).toEqual(bodyA);
    expect(calls).toBe(1);

    const { usageQuotas } = await import("../../src/db/schema");
    const quotaRows = await ctx.deps.db.select().from(usageQuotas).where(eq(usageQuotas.userId, userId));
    const daily = quotaRows.find((row) => row.period === "daily");
    expect(daily?.tutorMessagesUsed).toBe(1);
  });

  it("does not persist an opening if exchanges land while the model is still running", async () => {
    let release: ((text: string) => void) | undefined;
    let calls = 0;
    streamTextMock.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return {
          usage: Promise.resolve({
            inputTokens: 10,
            outputTokens: 4,
            inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
          }),
          text: new Promise<string>((resolve) => {
            release = resolve;
          }),
          toTextStreamResponse: () => new Response("pending"),
        };
      }
      return tutorStreamResult("¿Qué observás?");
    });
    generateObjectMock.mockResolvedValue({
      object: {
        demonstratedUnderstanding: "developing",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
        recommendedBand: "guiding",
        rationale: "x",
      },
      usage: { inputTokens: 50, outputTokens: 10 },
    });

    const { app, headers, session } = await setupTopicSession("opening-stale-exchanges@example.com");
    const openingPromise = app.request(`/v1/sessions/${session.id}/opening`, { method: "POST", headers });
    await vi.waitFor(() => expect(release).toBeDefined());
    const exchangeRes = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "ya empecé" }),
    });
    expect(exchangeRes.status).toBe(200);
    release!(OPENING_TEXT);
    const openingRes = await openingPromise;
    expect(openingRes.status).toBe(409);

    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.opening).toBeNull();
    expect(full.exchanges).toHaveLength(1);
  });
});
