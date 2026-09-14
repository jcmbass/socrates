/**
 * Slice localización (A3b s4/AJUSTE 4) — wiring de la preferred language del
 * estudiante a los prompts del tutor, milestone y assessor, corriendo el
 * flujo COMPLETO del turno (route → adapter → persistencia) contra fakes.
 * Misma disciplina que sessions-happy.test.ts: mock de `streamText`/
 * `generateObject` desde "ai" + fakeProviderResolver — cero red.
 *
 * La regla de wiring que estos tests congelan (AJUSTE 4 del arquitecto):
 *   - locale "en" → la opción SÍ se pasa: la sección de idioma aparece como
 *     última sección del system prompt y la versión persistida es la
 *     variante *-locale (patrón G4).
 *   - locale "es" (el default de TODA la base instalada, que nunca eligió
 *     idioma) → la opción NO se pasa: el render es byte-idéntico al
 *     histórico y la versión persistida es la default validada. Pasar "es"
 *     explícito apendaría la sección Spanish y rompería esa identidad.
 *   - El judge NO se toca: su prompt es una rúbrica de dos flags booleanos
 *     sin campo de texto libre (apps/server/src/models/judge.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { getSystemPrompt } from "@buxo/core/prompts";
import { getAssessorSystemPrompt } from "@buxo/core/assess";
import { MILESTONE_PROMPT_VERSION, MILESTONE_PROMPT_VERSION_LOCALE } from "@buxo/core/milestone-prompt";
import { PROMPT_VERSION_LOCALE } from "@buxo/core/prompts";
import { ASSESSOR_PROMPT_VERSION, ASSESSOR_PROMPT_VERSION_LOCALE } from "../../src/models/assess";
import { assessments } from "../../src/db/schema";
import type { CourseBody, SubjectBody, SessionBody, FullSessionBody } from "../support/http-types";

interface MilestoneBody {
  id: string;
  title: string;
  order: number;
  kind: string;
  coversUpToOrder: number;
}

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
    recommendedBand: "guiding",
    rationale: "El estudiante explicó el paso con sus propias palabras.",
    ...overrides,
  };
}

function usage(inputTokens = 200, outputTokens = 50) {
  return { inputTokens, outputTokens, inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 } };
}

function systemContentOf(call: { system: string | { content: string } }): string {
  return typeof call.system === "string" ? call.system : call.system.content;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

const SUBJECT_NAME = "Cálculo I";

describe("sessions — wiring de preferredLanguageCode a los prompts (slice localización)", () => {
  let ctx: TestContext;

  beforeEach(() => {
    streamTextMock.mockReset();
    generateObjectMock.mockReset();
  });

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setupSession(
    email: string,
    options: { patchLocale?: "en"; sessionBody?: Record<string, string>; extraTopics?: { milestones?: boolean } } = {},
  ) {
    ctx = await buildTestDeps({ envOverrides: { JUDGE_SAMPLE_RATE: 0, MASTERY_ASSESSOR_SAMPLE_RATE: 0 } });
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    if (options.patchLocale) {
      const patchRes = await app.request("/v1/me", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ preferredLanguageCode: options.patchLocale }),
      });
      expect(patchRes.status).toBe(204);
    }

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: SUBJECT_NAME }) }),
    );

    let milestoneId: string | undefined;
    if (options.extraTopics?.milestones) {
      await app.request(`/v1/temario/${subject.id}/topics`, { method: "POST", headers, body: JSON.stringify({ title: "Enlace iónico" }) });
      const milestone = await readJson<MilestoneBody>(
        await app.request(`/v1/temario/${subject.id}/milestones`, {
          method: "POST",
          headers,
          body: JSON.stringify({ kind: "parcial", title: "Parcial 1", coversUpToOrder: 0 }),
        }),
      );
      milestoneId = milestone.id;
      options.sessionBody = { subjectId: subject.id, milestoneId };
    }

    const session = await readJson<SessionBody>(
      await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify(options.sessionBody ?? { subjectId: subject.id }) }),
    );

    return { app, headers, session, subject };
  }

  async function postExchange(ctx2: TestContext, app: ReturnType<typeof createApp>, headers: Record<string, string>, sessionId: string, message: string) {
    const res = await app.request(`/v1/sessions/${sessionId}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: message }),
    });
    expect(res.status).toBe(200);
    await flush();
  }

  it("(a) usuario con locale 'en': la sección EN llega al tutor y al assessor, y las versiones persistidas son las *-locale", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("Tell me what you notice about that slope."));
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const { app, headers, session } = await setupSession("locale-en@example.com", { patchLocale: "en" });
    // setupSession apaga el mastery (MASTERY_ASSESSOR_SAMPLE_RATE: 0); acá
    // lo re-enciendo vía deps + random 0 → el assessor de mastery corre y su
    // versión ES la que se persiste en assessments.assessorPromptVersion.
    ctx.deps.masteryAssessorSampleRate = 1;
    ctx.deps.random = () => 0;

    await postExchange(ctx, app, headers, session.id, "I think the derivative is 2x");

    // Tutor: sección EN apendizada + versión -locale en el Exchange.
    const tutorSystem = systemContentOf(streamTextMock.mock.calls[0][0]);
    expect(tutorSystem).toContain("the student's preferred language is English");
    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges[0].tutorPromptVersion).toBe(PROMPT_VERSION_LOCALE);

    // Assessor de banda (1ª llamada) y de mastery (2ª): ambos con la sección
    // EN + la regla del rationale.
    expect(generateObjectMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    const bandSystem = systemContentOf(generateObjectMock.mock.calls[0][0]);
    expect(bandSystem).toContain("the student's preferred language is English");
    expect(bandSystem).toContain("The rationale field is free text");

    // Versión persistida del assessor (mastery → assessments): *-locale.
    const rows = await ctx.deps.db.select().from(assessments).where(eq(assessments.sessionId, session.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assessorPromptVersion).toBe(ASSESSOR_PROMPT_VERSION_LOCALE);
    expect(ASSESSOR_PROMPT_VERSION_LOCALE).not.toBe(ASSESSOR_PROMPT_VERSION);
  });

  it("(b)/(e) AJUSTE 4 — usuario 'es' (default, nunca eligió): render byte-idéntico al histórico y versiones default", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("¿Qué observás sobre la pendiente?"));
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const { app, headers, session } = await setupSession("locale-es-default@example.com");

    await postExchange(ctx, app, headers, session.id, "Creo que la derivada es 2x");

    // Byte-identidad AJUSTE 4: el system del tutor es EXACTAMENTE el render
    // default (banda guiding, sin material, materia "Cálculo I") — sin la
    // sección de idioma.
    const tutorSystem = systemContentOf(streamTextMock.mock.calls[0][0]);
    expect(tutorSystem).toBe(getSystemPrompt("guiding", undefined, SUBJECT_NAME));
    expect(tutorSystem).not.toContain("preferred language");

    // Versión persistida: la default validada del env (BUXO_TUTOR_PROMPT_VERSION).
    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges[0].tutorPromptVersion).toBe("buxo-socratic-v3");

    // Assessor: idem — render default v3 (topicLabeling + tutorLedRubric),
    // sin sección de idioma.
    const bandSystem = systemContentOf(generateObjectMock.mock.calls[0][0]);
    expect(bandSystem).toBe(getAssessorSystemPrompt(SUBJECT_NAME, { topicLabeling: true, tutorLedRubric: true }));
    expect(bandSystem).not.toContain("preferred language");
  });

  it("(d) PATCH /v1/me: el siguiente exchange del MISMO usuario usa el nuevo idioma", async () => {
    streamTextMock
      .mockReturnValueOnce(tutorStreamResult("¿Qué observás sobre la pendiente?"))
      .mockReturnValueOnce(tutorStreamResult("What do you notice about the slope?"));
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const { app, headers, session } = await setupSession("locale-patch@example.com");

    // Turno 1: usuario aún 'es' (default de signup) → prompt default.
    await postExchange(ctx, app, headers, session.id, "Creo que la derivada es 2x");
    expect(systemContentOf(streamTextMock.mock.calls[0][0])).toBe(getSystemPrompt("guiding", undefined, SUBJECT_NAME));

    // Cambio de idioma efectivo (A3a): PATCH /v1/me.
    const patch = await app.request("/v1/me", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ preferredLanguageCode: "en" }),
    });
    expect(patch.status).toBe(204);

    // Turno 2: la sección EN aparece y la versión del Exchange 2 es -locale.
    await postExchange(ctx, app, headers, session.id, "I think the derivative is 2x");
    const secondSystem = systemContentOf(streamTextMock.mock.calls[1][0]);
    expect(secondSystem).toContain("the student's preferred language is English");

    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges[0].tutorPromptVersion).toBe("buxo-socratic-v3");
    expect(full.exchanges[1].tutorPromptVersion).toBe(PROMPT_VERSION_LOCALE);
  });

  it("(a-milestone) sesión de hito con usuario 'en': sección EN + versión buxo-milestone-v1-locale en el Exchange", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("Let's revisit the ionic bond."));
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const { app, headers, session } = await setupSession("locale-en-milestone@example.com", {
      patchLocale: "en",
      extraTopics: { milestones: true },
    });

    await postExchange(ctx, app, headers, session.id, "I think ionic bonds share electrons");

    const tutorSystem = systemContentOf(streamTextMock.mock.calls[0][0]);
    expect(tutorSystem).toContain("the student's preferred language is English");
    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges[0].tutorPromptVersion).toBe(MILESTONE_PROMPT_VERSION_LOCALE);
    expect(MILESTONE_PROMPT_VERSION_LOCALE).not.toBe(MILESTONE_PROMPT_VERSION);
  });

  it("(e-milestone) AJUSTE 4 — sesión de hito con usuario 'es': sin sección de idioma y versión default", async () => {
    streamTextMock.mockReturnValue(tutorStreamResult("Repasemos el enlace iónico."));
    generateObjectMock.mockResolvedValue({ object: assessorObject(), usage: usage() });

    const { app, headers, session } = await setupSession("locale-es-milestone@example.com", {
      extraTopics: { milestones: true },
    });

    await postExchange(ctx, app, headers, session.id, "Creo que el enlace iónico comparte electrones");

    const tutorSystem = systemContentOf(streamTextMock.mock.calls[0][0]);
    expect(tutorSystem).not.toContain("preferred language");
    expect(tutorSystem).not.toContain("Language:");
    const full = await readJson<FullSessionBody>(await app.request(`/v1/sessions/${session.id}`, { headers }));
    expect(full.exchanges[0].tutorPromptVersion).toBe(MILESTONE_PROMPT_VERSION);
  });
});