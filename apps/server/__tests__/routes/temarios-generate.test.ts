/**
 * Route-level tests for the P2 agentic temario generation endpoint.
 *
 * Uses BUXO_FAKE_MODELS=1 so the temario-builder executes provider-agnostic
 * tools deterministically without calling any real provider.
 *
 * P2 FIX1-5 (2026-07-21 post-real-run REVIEW): additional coverage for
 * idempotent duplicate tool calls (FIX2), consistent `generatedBy` state on
 * failure (FIX4), and durable cost recording (FIX5). FIX1 (no cross-model
 * failover) and FIX3 (subjectId from ToolContext, not model input) are unit
 * tests elsewhere (`packages/models/__tests__/temario-builder-adapter.test.ts`,
 * `apps/server/__tests__/models/tools.test.ts`) since they aren't observable
 * black-box through this fake (which never goes through a real failover
 * chain or a real model-supplied subjectId argument).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import { getOrCreateQuota } from "../../src/repositories/quotas";
import { buildTemarioBuilderSystemPrompt } from "@buxo/models/prompts/temario-builder-prompt";
import type { CourseBody, SubjectBody } from "../support/http-types";

interface FuenteBody {
  id: string;
  name: string;
  text: string;
  kind: string;
}

interface TopicBody {
  id: string;
  title: string;
  order: number;
  status: string;
  stars: number;
  recommended: boolean;
}

interface MilestoneBody {
  id: string;
  title: string;
  order: number;
  kind: string;
  coversUpToOrder: number;
  status: string;
}

interface TemarioBody {
  id: string;
  subjectId: string;
  topics: TopicBody[];
  milestones: MilestoneBody[];
  generatedBy: string;
}

interface GenerateResponse {
  temario: TemarioBody;
  generatedBy: string;
  result: { text: string; servedBy: unknown; promptVersion: string; costUsd: number | null };
}

describe("POST /v1/temario/:subjectId/temario:generate — P2 fake adapter", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function authedApp(email: string) {
    ctx = await buildTestDeps({ envOverrides: { BUXO_FAKE_MODELS: true } });
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Historia" }) }),
    );
    const fuente = await readJson<FuenteBody>(
      await app.request(`/v1/fuentes/${subject.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "guia.pdf", kind: "pdf", text: "Fake topics: T1, T2, T3" }),
      }),
    );
    return { app, token, headers, subject, fuente, userId };
  }

  it("generates topics + milestone and marks generatedBy='ai'", async () => {
    const { app, headers, subject, fuente } = await authedApp("generate-ai@example.com");

    const res = await app.request(`/v1/temario/${subject.id}/temario:generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fuenteId: fuente.id }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<GenerateResponse>(res);
    expect(body.generatedBy).toBe("ai");
    expect(body.temario.topics).toHaveLength(3);
    expect(body.temario.milestones).toHaveLength(1);
    expect(body.temario.generatedBy).toBe("ai");
    expect(body.result.promptVersion).toBe("temario-builder-v3");
  });

  it("returns 404 and does not create for another user's subject", async () => {
    const { app: appA, subject, fuente } = await authedApp("generate-owner-a@example.com");
    const { token: tokenB } = await signupAndVerify(appA, ctx.deps, "generate-intruder-b@example.com");

    const res = await appA.request(`/v1/temario/${subject.id}/temario:generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      body: JSON.stringify({ fuenteId: fuente.id }),
    });
    expect(res.status).toBe(404);

    const get = await appA.request(`/v1/temario/${subject.id}`, { headers: { authorization: `Bearer ${tokenB}` } });
    expect(get.status).toBe(404);
  });

  it("(c) usuario 'en': el builder recibe la variante EN (system+user) y la versión temario-builder-v3-en viaja en el resultado", async () => {
    const { app, headers, subject, fuente } = await authedApp("generate-locale-en@example.com");
    const patch = await app.request("/v1/me", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ preferredLanguageCode: "en" }),
    });
    expect(patch.status).toBe(204);

    // Espía sobre el adapter real (fake) para capturar el system/prompt
    // exacto que el route le pasó — el fake no expone eso black-box.
    const adapter = ctx.deps.models.temarioBuilderAdapter;
    const original = adapter.generateTemario.bind(adapter);
    const spy = vi.spyOn(adapter, "generateTemario").mockImplementation((input) => original(input));

    const res = await app.request(`/v1/temario/${subject.id}/temario:generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fuenteId: fuente.id }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<GenerateResponse>(res);
    expect(body.generatedBy).toBe("ai");
    expect(body.temario.topics).toHaveLength(3);
    expect(body.result.promptVersion).toBe("temario-builder-v3-en");

    expect(spy).toHaveBeenCalledTimes(1);
    const seen = spy.mock.calls[0][0];
    expect(seen.system).toContain("You are an academic assistant");
    expect(seen.system).toContain("written in English");
    expect(seen.system).not.toContain("Sos un asistente académico");
    expect(seen.prompt).toContain("Course syllabus");
  });

  it("(e-temario) AJUSTE 4 — usuario 'es' (default): el builder recibe el template español byte-idéntico y la versión default", async () => {
    const { app, headers, subject, fuente } = await authedApp("generate-locale-es@example.com");

    const adapter = ctx.deps.models.temarioBuilderAdapter;
    const original = adapter.generateTemario.bind(adapter);
    const spy = vi.spyOn(adapter, "generateTemario").mockImplementation((input) => original(input));

    const res = await app.request(`/v1/temario/${subject.id}/temario:generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fuenteId: fuente.id }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<GenerateResponse>(res);
    expect(body.result.promptVersion).toBe("temario-builder-v3");

    expect(spy).toHaveBeenCalledTimes(1);
    const seen = spy.mock.calls[0][0];
    // Byte-identidad AJUSTE 4: exactamente el render histórico en español.
    expect(seen.system).toBe(buildTemarioBuilderSystemPrompt("Historia"));
    expect(seen.system).not.toContain("academic assistant");
    expect(seen.prompt).toContain("Programa de estudio");
    expect(seen.prompt).not.toContain("Course syllabus");
  });

  it("fail-loud: returns 500 when the fake provider lacks tool support", async () => {
    const { app, headers, subject, fuente } = await authedApp("generate-fail-loud@example.com");

    // El fake adapter detecta este marcador y simula un proveedor sin tool-calling.
    await app.request(`/v1/fuentes/${subject.id}/${fuente.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ text: "__FAKE_NO_TOOL_SUPPORT__" }),
    });

    const res = await app.request(`/v1/temario/${subject.id}/temario:generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fuenteId: fuente.id }),
    });
    expect(res.status).toBe(500);
    const errorBody = await readJson<{ code: string }>(res);
    expect(errorBody.code).toBe("internal_error");

    // Beta-real 05: generate failure must NOT consume/delete the Fuente — student retries without re-upload.
    const fuentes = await readJson<FuenteBody[]>(await app.request(`/v1/fuentes/${subject.id}`, { headers }));
    expect(fuentes.some((f) => f.id === fuente.id)).toBe(true);
  });

  it("FIX4: a failed generation does NOT leave the temario marked generatedBy='ai' — it stays 'manual' (the honest pre-call state)", async () => {
    const { app, headers, subject, fuente } = await authedApp("generate-fix4-manual@example.com");

    await app.request(`/v1/fuentes/${subject.id}/${fuente.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ text: "__FAKE_NO_TOOL_SUPPORT__" }),
    });

    const res = await app.request(`/v1/temario/${subject.id}/temario:generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fuenteId: fuente.id }),
    });
    expect(res.status).toBe(500);

    const get = await app.request(`/v1/temario/${subject.id}`, { headers });
    const temario = await readJson<TemarioBody>(get);
    expect(temario.generatedBy).toBe("manual");
    expect(temario.topics).toHaveLength(0);
  });

  it("FIX4: a failed RE-generation on an already ai-edited temario reverts to 'ai-edited', not 'ai' nor 'manual'", async () => {
    const { app, headers, subject, fuente } = await authedApp("generate-fix4-ai-edited@example.com");

    const first = await app.request(`/v1/temario/${subject.id}/temario:generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fuenteId: fuente.id }),
    });
    const generated = await readJson<GenerateResponse>(first);
    expect(generated.generatedBy).toBe("ai");

    const topic = generated.temario.topics[0]!;
    await app.request(`/v1/temario/topics/${topic.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "Editado a mano" }),
    });
    const afterEdit = await readJson<TemarioBody>(await app.request(`/v1/temario/${subject.id}`, { headers }));
    expect(afterEdit.generatedBy).toBe("ai-edited");

    // Force the SECOND generation attempt to fail.
    await app.request(`/v1/fuentes/${subject.id}/${fuente.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ text: "__FAKE_NO_TOOL_SUPPORT__" }),
    });
    const second = await app.request(`/v1/temario/${subject.id}/temario:generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fuenteId: fuente.id }),
    });
    expect(second.status).toBe(500);

    const after = await readJson<TemarioBody>(await app.request(`/v1/temario/${subject.id}`, { headers }));
    expect(after.generatedBy).toBe("ai-edited");
    // Topics from the successful first generation are preserved (P2 FIX2's
    // idempotent dedup means a later successful retry could safely reuse them).
    expect(after.topics.map((t) => t.title)).toContain("Editado a mano");
  });

  it("FIX2: survives a duplicated tool call for a title already created (route-level, exact real-run shape)", async () => {
    const { app, headers, subject } = await authedApp("generate-fix2-dup@example.com");
    const fuente = await readJson<FuenteBody>(
      await app.request(`/v1/fuentes/${subject.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "guia.pdf",
          kind: "pdf",
          // 10 distinct titles, then a duplicate of the FIRST — the exact
          // shape of the real Haiku-run bug (10 topics committed, then a
          // repeated createTopic call for the first title).
          text: "Fake topics: T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T1",
        }),
      }),
    );

    const res = await app.request(`/v1/temario/${subject.id}/temario:generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fuenteId: fuente.id }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<GenerateResponse>(res);
    expect(body.generatedBy).toBe("ai");
    expect(body.temario.topics).toHaveLength(10);
    expect(body.temario.topics.map((t) => t.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("FIX5: cost from a successful generation is recorded durably in usage_quotas (not a Noop sink)", async () => {
    const { app, headers, subject, fuente, userId } = await authedApp("generate-fix5-cost@example.com");

    const res = await app.request(`/v1/temario/${subject.id}/temario:generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fuenteId: fuente.id }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<GenerateResponse>(res);
    expect(body.result.costUsd).not.toBeNull();

    const dailyQuota = await getOrCreateQuota(ctx.deps.db, userId, "daily", { capTutorMessages: null, capCostUsd: null });
    expect(dailyQuota.costUsdEstimate).toBeGreaterThan(0);
    const monthlyQuota = await getOrCreateQuota(ctx.deps.db, userId, "monthly", { capTutorMessages: null, capCostUsd: null });
    expect(monthlyQuota.costUsdEstimate).toBeGreaterThan(0);
  });

  it("editing a topic after AI generation flips generatedBy to 'ai-edited'", async () => {
    const { app, headers, subject, fuente } = await authedApp("generate-edit@example.com");

    const generate = await app.request(`/v1/temario/${subject.id}/temario:generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fuenteId: fuente.id }),
    });
    const generated = await readJson<GenerateResponse>(generate);
    expect(generated.temario.generatedBy).toBe("ai");

    const topic = generated.temario.topics[0];
    const patch = await app.request(`/v1/temario/topics/${topic.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "T1 editado" }),
    });
    expect(patch.status).toBe(200);

    const get = await app.request(`/v1/temario/${subject.id}`, { headers });
    const temario = await readJson<TemarioBody>(get);
    expect(temario.generatedBy).toBe("ai-edited");
  });

  it("the auto-created empty temario on subject creation marks generatedBy='manual'", async () => {
    const { app, headers, subject } = await authedApp("generate-manual@example.com");

    const res = await app.request(`/v1/temario/${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<TemarioBody>(res);
    expect(body.generatedBy).toBe("manual");
    expect(body.topics).toHaveLength(0);
  });
});
