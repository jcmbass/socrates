/**
 * Route-level tests for temario CRUD — Fase P1.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody } from "../support/http-types";

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

interface SeedAttributionBody {
  title: string;
  publisher: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
}

interface TemarioBody {
  id: string;
  subjectId: string;
  topics: TopicBody[];
  milestones: MilestoneBody[];
  seedCatalogKey: string | null;
  seedAttribution: SeedAttributionBody | null;
  seedMaterialLang: "es" | "en" | null;
}

describe("GET /v1/temario/:subjectId and write routes — P1 auth scope", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function authedApp(email: string) {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Historia" }) }),
    );
    return { app, token, headers, subject };
  }

  it("reads the auto-created empty temario for a subject", async () => {
    const { app, headers, subject } = await authedApp("temario-read@example.com");
    const res = await app.request(`/v1/temario/${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<TemarioBody>(res);
    expect(body.subjectId).toBe(subject.id);
    expect(body.topics).toEqual([]);
  });

  it("creates, updates, reorders and deletes topics with user scope", async () => {
    const { app, headers, subject } = await authedApp("temario-write@example.com");

    const create = await app.request(`/v1/temario/${subject.id}/topics`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Revolución francesa" }),
    });
    expect(create.status).toBe(201);
    const topic = await readJson<TopicBody>(create);
    expect(topic.title).toBe("Revolución francesa");
    expect(topic.stars).toBe(0);

    const patch = await app.request(`/v1/temario/topics/${topic.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "Revolución francesa (1789)" }),
    });
    expect(patch.status).toBe(200);
    const updated = await readJson<TopicBody>(patch);
    expect(updated.title).toBe("Revolución francesa (1789)");

    const reorder = await app.request(`/v1/temario/${subject.id}/topics/reorder`, {
      method: "POST",
      headers,
      body: JSON.stringify({ orderedIds: [topic.id] }),
    });
    expect(reorder.status).toBe(200);

    const del = await app.request(`/v1/temario/topics/${topic.id}`, { method: "DELETE", headers });
    expect(del.status).toBe(204);
  });

  it("returns 404 when trying to create a topic under another user's subject", async () => {
    const { app: appA, subject } = await authedApp("temario-owner-a@example.com");
    const { token: tokenB } = await signupAndVerify(appA, ctx.deps, "temario-intruder-b@example.com");

    const res = await appA.request(`/v1/temario/${subject.id}/topics`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "X" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects milestone coversUpToOrder beyond existing topics", async () => {
    const { app, headers, subject } = await authedApp("temario-hito@example.com");
    await app.request(`/v1/temario/${subject.id}/topics`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Tema" }),
    });

    const res = await app.request(`/v1/temario/${subject.id}/milestones`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "parcial", title: "P1", coversUpToOrder: 99 }),
    });
    expect(res.status).toBe(500); // invariant throws -> internal_error via app.onError
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("internal_error");
  });
});

/**
 * C2-d: `seedAttribution`/`seedCatalogKey` colgados de esta MISMA respuesta
 * (no endpoint nuevo) — apps/mobile/app/subjects/[subjectId]/temario.tsx es
 * el único consumidor, y ya tiene `subject` cargado en memoria en este
 * handler (`loadSubjectAndCheckOwnership`). C2-e añade `seedMaterialLang`
 * al mismo bloque (idioma del libro fuente, vía `seedSourceLangFor`) para
 * la nota "Material en inglés" de la card de home.
 */
describe("GET /v1/temario/:subjectId — seedAttribution/seedCatalogKey/seedMaterialLang (C2-d/C2-e)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("a manual (non-seed) subject's temario has both fields null", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "temario-attr-manual@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Historia" }) }),
    );

    const res = await app.request(`/v1/temario/${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<TemarioBody>(res);
    expect(body.seedCatalogKey).toBeNull();
    expect(body.seedAttribution).toBeNull();
    expect(body.seedMaterialLang).toBeNull();
  });

  it("a seed-activated subject's temario carries seedCatalogKey and the ES book (Física universitaria) for an 'es' user", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "temario-attr-seed-es@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-universidad-1" }) }),
    );
    const activated = await readJson<SubjectBody[]>(
      await app.request(`/v1/courses/${course.id}/seed-subjects`, {
        method: "POST",
        headers,
        body: JSON.stringify({ subjectKeys: ["fisica"] }),
      }),
    );
    const subject = activated[0]!;

    const res = await app.request(`/v1/temario/${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<TemarioBody>(res);
    expect(body.seedCatalogKey).toBe("universidad/fisica");
    expect(body.seedAttribution).not.toBeNull();
    expect(body.seedAttribution!.title).toBe("Física universitaria, volumen 1");
    // C2-e: el libro detrás del temario SÍ está en el idioma del usuario.
    expect(body.seedMaterialLang).toBe("es");
  });

  it("bachillerato/fisica (EN-only source) still returns an attribution for an 'es' user — falls back instead of null", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "temario-attr-fallback@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const activated = await readJson<SubjectBody[]>(
      await app.request(`/v1/courses/${course.id}/seed-subjects`, {
        method: "POST",
        headers,
        body: JSON.stringify({ subjectKeys: ["fisica"] }),
      }),
    );
    const subject = activated[0]!;

    const res = await app.request(`/v1/temario/${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<TemarioBody>(res);
    expect(body.seedCatalogKey).toBe("bachillerato/fisica");
    expect(body.seedAttribution).not.toBeNull();
    expect(body.seedAttribution!.title).toBe("Physics");
    // C2-e: la ÚNICA fuente es EN — `seedMaterialLang` diverge del idioma de
    // la UI del usuario 'es' (temario en español, libro en inglés); es
    // exactamente el caso que dispara la nota "Material en inglés".
    expect(body.seedMaterialLang).toBe("en");
  });
});
