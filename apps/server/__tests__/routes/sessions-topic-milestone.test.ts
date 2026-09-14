/**
 * P5 (DF-P12/DF-P05/DF-P11) — sessions scoped to a topic or to a milestone
 * review round. Same "mock streamText/generateObject, fake ProviderResolver"
 * discipline as sessions-happy.test.ts — zero real model calls (R1).
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

interface TopicBody {
  id: string;
  title: string;
  order: number;
}
interface MilestoneBody {
  id: string;
  title: string;
  order: number;
  kind: string;
  coversUpToOrder: number;
}
interface FuenteBody {
  id: string;
  name: string;
  text: string;
  kind: string;
}
interface ActiveSessionSummaryBody {
  id: string;
  subjectId: string;
  kind: string;
  topicId: string | null;
  milestoneId: string | null;
}

function tutorStreamResult(text: string) {
  return {
    usage: Promise.resolve({ inputTokens: 500, outputTokens: 100, inputTokenDetails: { noCacheTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
    text: Promise.resolve(text),
    toTextStreamResponse: () => new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } }),
  };
}

function systemContentOf(call: { system: string | { content: string } }): string {
  return typeof call.system === "string" ? call.system : call.system.content;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("POST /v1/sessions with topicId/milestoneId (P5)", () => {
  let ctx: TestContext;

  beforeEach(() => {
    streamTextMock.mockReset();
    generateObjectMock.mockReset();
  });

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setup(email: string) {
    ctx = await buildTestDeps({ envOverrides: { JUDGE_SAMPLE_RATE: 0 } });
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Química 1" }) }),
    );
    return { app, headers, subject };
  }

  async function addTopic(app: ReturnType<typeof createApp>, headers: Record<string, string>, subjectId: string, title: string) {
    return readJson<TopicBody>(
      await app.request(`/v1/temario/${subjectId}/topics`, { method: "POST", headers, body: JSON.stringify({ title }) }),
    );
  }

  async function addMilestone(
    app: ReturnType<typeof createApp>,
    headers: Record<string, string>,
    subjectId: string,
    input: { kind: "parcial" | "examen_final"; title: string; coversUpToOrder: number },
  ) {
    return readJson<MilestoneBody>(
      await app.request(`/v1/temario/${subjectId}/milestones`, { method: "POST", headers, body: JSON.stringify(input) }),
    );
  }

  async function addFuente(app: ReturnType<typeof createApp>, headers: Record<string, string>, subjectId: string, name: string, text: string) {
    return readJson<FuenteBody>(
      await app.request(`/v1/fuentes/${subjectId}`, { method: "POST", headers, body: JSON.stringify({ name, kind: "pdf", text }) }),
    );
  }

  it("DF-P12: a topic session's tutor call includes the topic title AND the subject's fuentes in its context", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("¿Qué sabés de los enlaces iónicos?"));
    generateObjectMock.mockResolvedValue({
      object: { demonstratedUnderstanding: "developing", explainedInOwnWords: true, guessedOrPatternMatched: false, recommendedBand: "probing", rationale: "x" },
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const { app, headers, subject } = await setup("topic-session@example.com");
    const topic = await addTopic(app, headers, subject.id, "Enlace iónico");
    await addFuente(app, headers, subject.id, "Guía de enlaces.pdf", "El enlace iónico se forma por transferencia de electrones entre átomos.");

    const session = await readJson<SessionBody>(
      await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id, topicId: topic.id }) }),
    );
    expect(session.kind).toBe("topic");
    expect(session.topicId).toBe(topic.id);

    await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "no sé bien" }),
    });

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const system = systemContentOf(streamTextMock.mock.calls[0][0]);
    expect(system).toContain("Tema actual: Enlace iónico");
    expect(system).toContain("El enlace iónico se forma por transferencia de electrones entre átomos.");
  });

  it("rejects topicId + milestoneId together (mutually exclusive)", async () => {
    const { app, headers, subject } = await setup("mutual-exclusive@example.com");
    const topic = await addTopic(app, headers, subject.id, "Tema A");
    const milestone = await addMilestone(app, headers, subject.id, { kind: "parcial", title: "Parcial 1", coversUpToOrder: 0 });

    const res = await app.request("/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectId: subject.id, topicId: topic.id, milestoneId: milestone.id }),
    });
    expect(res.status).toBe(400);
  });

  it("404s when topicId doesn't belong to the subject's temario", async () => {
    const { app, headers, subject } = await setup("bad-topic@example.com");
    const res = await app.request("/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectId: subject.id, topicId: "nonexistent-topic" }),
    });
    expect(res.status).toBe(404);
  });

  it("404s when milestoneId doesn't belong to the subject's temario", async () => {
    const { app, headers, subject } = await setup("bad-milestone@example.com");
    const res = await app.request("/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectId: subject.id, milestoneId: "nonexistent-milestone" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /v1/sessions?status=active surfaces kind/topicId/milestoneId, and two topics of the same subject get INDEPENDENT sessions", async () => {
    const { app, headers, subject } = await setup("independent-topics@example.com");
    const topicA = await addTopic(app, headers, subject.id, "Tema A");
    const topicB = await addTopic(app, headers, subject.id, "Tema B");

    await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id, topicId: topicA.id }) });
    await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id, topicId: topicB.id }) });

    const list = await readJson<ActiveSessionSummaryBody[]>(await app.request("/v1/sessions?status=active", { headers }));
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.topicId === topicA.id)).toMatchObject({ kind: "topic" });
    expect(list.find((s) => s.topicId === topicB.id)).toMatchObject({ kind: "topic" });
  });

  describe("milestone review-round sessions (DF-P05)", () => {
    async function setupMilestoneScope(email: string) {
      const { app, headers, subject } = await setup(email);
      const t0 = await addTopic(app, headers, subject.id, "Enlace iónico");
      const t1 = await addTopic(app, headers, subject.id, "Enlace covalente");
      await addFuente(app, headers, subject.id, "Guía de enlaces.pdf", "El enlace iónico transfiere electrones; el covalente los comparte.");
      const milestone = await addMilestone(app, headers, subject.id, { kind: "parcial", title: "Parcial 1", coversUpToOrder: t1.order });
      return { app, headers, subject, topics: [t0, t1], milestone };
    }

    it("uses the milestone adapter/prompt — cumulative scope + fuentes end up in the system prompt", async () => {
      streamTextMock.mockReturnValue(tutorStreamResult("[fake repaso] ¿por dónde querés empezar?"));

      const { app, headers, subject, milestone } = await setupMilestoneScope("milestone-scope@example.com");

      const session = await readJson<SessionBody>(
        await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id, milestoneId: milestone.id }) }),
      );
      expect(session.kind).toBe("milestone");
      expect(session.milestoneId).toBe(milestone.id);

      await app.request(`/v1/sessions/${session.id}/exchanges`, { method: "POST", headers, body: JSON.stringify({ studentMessage: "listo" }) });

      expect(streamTextMock).toHaveBeenCalledTimes(1);
      const system = systemContentOf(streamTextMock.mock.calls[0][0]);
      expect(system).toContain("Parcial 1");
      expect(system).toContain("Enlace iónico");
      expect(system).toContain("Enlace covalente");
      expect(system).toContain("El enlace iónico transfiere electrones; el covalente los comparte.");
    });

    it("DF-P05: does NOT run the assessor/mastery loop for a milestone session (it's a review, not a scored turn)", async () => {
      streamTextMock.mockReturnValue(tutorStreamResult("[fake repaso] ¿qué recordás?"));

      const { app, headers, subject, milestone } = await setupMilestoneScope("milestone-no-assessor@example.com");
      const session = await readJson<SessionBody>(
        await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id, milestoneId: milestone.id }) }),
      );

      await app.request(`/v1/sessions/${session.id}/exchanges`, { method: "POST", headers, body: JSON.stringify({ studentMessage: "listo" }) });
      await flush();

      expect(generateObjectMock).not.toHaveBeenCalled();

      const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
      expect(full.exchanges).toHaveLength(1); // transcript still persisted
      expect(full.bandChanges).toHaveLength(1); // only the initial band change — no auto move from a (skipped) assessor
    });

    it("DF-P05: does NOT gate — the student can still open/continue a normal topic session on the same subject afterwards", async () => {
      streamTextMock.mockReturnValue(tutorStreamResult("[fake repaso] respuesta"));

      const { app, headers, subject, topics, milestone } = await setupMilestoneScope("milestone-not-gating@example.com");
      const milestoneSession = await readJson<SessionBody>(
        await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id, milestoneId: milestone.id }) }),
      );
      await app.request(`/v1/sessions/${milestoneSession.id}/exchanges`, { method: "POST", headers, body: JSON.stringify({ studentMessage: "listo" }) });

      // Nothing about the milestone round prevents opening a fresh topic session right after.
      const topicRes = await app.request("/v1/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify({ subjectId: subject.id, topicId: topics[0].id }),
      });
      expect(topicRes.status).toBe(201);
      const topicSession = await readJson<SessionBody>(topicRes);
      expect(topicSession.kind).toBe("topic");
    });

    it("DF-P05 cumulative scope: a SECOND milestone's system prompt covers ALL prior topics but the emphasis marker lands only on the newer ones", async () => {
      streamTextMock.mockReturnValue(tutorStreamResult("[fake repaso] respuesta"));

      const { app, headers, subject } = await setup("milestone-second@example.com");
      const t0 = await addTopic(app, headers, subject.id, "Tema muy viejo");
      const t1 = await addTopic(app, headers, subject.id, "Tema reciente");
      await addFuente(app, headers, subject.id, "Guía.pdf", "Contenido de ambos temas.");
      const parcial1 = await addMilestone(app, headers, subject.id, { kind: "parcial", title: "Parcial 1", coversUpToOrder: t0.order });
      const parcial2 = await addMilestone(app, headers, subject.id, { kind: "parcial", title: "Parcial 2", coversUpToOrder: t1.order });
      expect(parcial2.order).toBeGreaterThan(parcial1.order);

      const session = await readJson<SessionBody>(
        await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id, milestoneId: parcial2.id }) }),
      );
      await app.request(`/v1/sessions/${session.id}/exchanges`, { method: "POST", headers, body: JSON.stringify({ studentMessage: "listo" }) });

      const system = systemContentOf(streamTextMock.mock.calls[0][0]);
      // Cumulative: BOTH topics appear (not just the newest one).
      expect(system).toContain("Tema muy viejo");
      expect(system).toContain("Tema reciente");
      // Emphasis marker attaches only to the topic after parcial1's scope.
      expect(system).toContain("Tema reciente [ÉNFASIS");
      expect(system).not.toContain("Tema muy viejo [ÉNFASIS");
    });
  });
});
