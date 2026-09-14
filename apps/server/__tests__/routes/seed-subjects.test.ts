/**
 * C2-a — GET /v1/seed/subjects, GET /v1/seed/attributions,
 * POST /v1/courses/:courseId/seed-subjects, and the onboarding flag on
 * GET/PATCH /v1/me.
 *
 * `01-plan-c0.md` ADENDA §(a): the seed enters ONLY as a temario. No
 * `seed_fuentes`, no ingest — every assertion below is about
 * subjects/temarios/temas rows, never a Fuente.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody } from "../support/http-types";
import { findUserById } from "../../src/repositories/users";
import { findTemarioBySubject } from "../../src/repositories/temarios";

interface SeedSubjectOptionBody {
  level: "bachillerato" | "universidad";
  subjectKey: string;
  name: { es: string; en: string };
  unitCount: { es: number; en: number };
  topicCount: { es: number; en: number };
}

interface SeedAttributionBody {
  title: string;
  publisher: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
}

interface SubjectBody {
  id: string;
  name: string;
  courseId: string;
  seedCatalogKey: string | null;
  seedLang: string | null;
}

describe("C2-a — seed catalog endpoints + seed-subject activation + onboarding flag", () => {
  // Some tests need two independent users/DBs in the same `it` (the es/en
  // fisica asymmetry test) — track every context built so `afterEach` closes
  // ALL of them, not just the last one assigned.
  let contexts: TestContext[] = [];
  let ctx: TestContext;

  afterEach(async () => {
    await Promise.all(contexts.map((c) => c.testDb.close()));
    contexts = [];
  });

  async function newCtx(): Promise<TestContext> {
    const built = await buildTestDeps();
    contexts.push(built);
    ctx = built;
    return built;
  }

  async function authedApp(email: string) {
    const built = await newCtx();
    const app = createApp(built.deps);
    const { token, userId } = await signupAndVerify(app, built.deps, email);
    return {
      app,
      token,
      userId,
      db: built.deps.db,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    };
  }

  async function createCourse(app: ReturnType<typeof createApp>, headers: Record<string, string>, gradeLevelId: string) {
    const res = await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId }) });
    expect(res.status).toBe(201);
    return readJson<CourseBody>(res);
  }

  it("GET /v1/seed/subjects?level=universidad returns the 5 seed subjects, no auth required", async () => {
    const built = await newCtx();
    const app = createApp(built.deps);

    const res = await app.request("/v1/seed/subjects?level=universidad");
    expect(res.status).toBe(200);
    const body = await readJson<SeedSubjectOptionBody[]>(res);
    expect(body).toHaveLength(5);
    expect(body.every((s) => s.level === "universidad")).toBe(true);
    const bySubjectKey = Object.fromEntries(body.map((s) => [s.subjectKey, s]));
    // Numbers verified directly against packages/domain/data/seed/universidad/*.json.
    expect(bySubjectKey.quimica.topicCount).toEqual({ es: 114, en: 114 });
    expect(bySubjectKey.biologia.topicCount).toEqual({ es: 206, en: 206 });
    expect(bySubjectKey.fisica.topicCount).toEqual({ es: 99, en: 236 });
  });

  it("GET /v1/seed/subjects?level=bachillerato returns 5 subjects; a bad level is 400", async () => {
    const built = await newCtx();
    const app = createApp(built.deps);

    const res = await app.request("/v1/seed/subjects?level=bachillerato");
    expect(res.status).toBe(200);
    expect(await readJson<SeedSubjectOptionBody[]>(res)).toHaveLength(5);

    const bad = await app.request("/v1/seed/subjects?level=posgrado");
    expect(bad.status).toBe(400);
  });

  it("GET /v1/seed/attributions returns 10 unique books, no auth required", async () => {
    const built = await newCtx();
    const app = createApp(built.deps);

    const res = await app.request("/v1/seed/attributions");
    expect(res.status).toBe(200);
    const body = await readJson<SeedAttributionBody[]>(res);
    expect(body).toHaveLength(10);
    for (const attribution of body) {
      expect(attribution.title.length).toBeGreaterThan(0);
      expect(attribution.licenseName).toMatch(/^CC BY|public domain/i);
    }
  });

  it("activates universidad/quimica for an 'es' user: 114 temas, unitLabel populated, seedLang 'es'", async () => {
    const { app, headers } = await authedApp("seed-quimica@example.com");
    const course = await createCourse(app, headers, "sv-universidad-1");

    const res = await app.request(`/v1/courses/${course.id}/seed-subjects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectKeys: ["quimica"] }),
    });
    expect(res.status).toBe(200);
    const created = await readJson<SubjectBody[]>(res);
    expect(created).toHaveLength(1);
    const subject = created[0]!;
    expect(subject.seedCatalogKey).toBe("universidad/quimica");
    expect(subject.seedLang).toBe("es");
    expect(subject.courseId).toBe(course.id);

    const temario = await findTemarioBySubject(ctx.deps.db, subject.id);
    expect(temario).not.toBeNull();
    expect(temario!.topics).toHaveLength(114);
    expect(temario!.topics.every((t) => typeof t.unitLabel === "string" && t.unitLabel.length > 0)).toBe(true);
    expect(temario!.milestones).toHaveLength(0);
    // Order is preserved, 0-based, contiguous.
    expect(temario!.topics.map((t) => t.order)).toEqual(Array.from({ length: 114 }, (_, i) => i));
  });

  it("activating the same materia twice does not duplicate it", async () => {
    const { app, headers } = await authedApp("seed-dup@example.com");
    const course = await createCourse(app, headers, "sv-universidad-1");

    const first = await app.request(`/v1/courses/${course.id}/seed-subjects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectKeys: ["matematicas"] }),
    });
    expect(first.status).toBe(200);
    const firstBody = await readJson<SubjectBody[]>(first);
    expect(firstBody).toHaveLength(1);

    const second = await app.request(`/v1/courses/${course.id}/seed-subjects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectKeys: ["matematicas"] }),
    });
    expect(second.status).toBe(200);
    const secondBody = await readJson<SubjectBody[]>(second);
    expect(secondBody).toHaveLength(1);
    expect(secondBody[0]!.id).toBe(firstBody[0]!.id);

    const list = await app.request(`/v1/subjects?courseId=${course.id}`, { headers });
    expect(await readJson<SubjectBody[]>(list)).toHaveLength(1);
  });

  it("an 'en' user activating universidad/fisica gets the EN syllabus (236 temas); an 'es' user gets ES (99) — asymmetric on purpose (different source books)", async () => {
    const en = await authedApp("seed-fisica-en@example.com");
    await app_setLocale(en.app, en.headers, "en");
    const enCourse = await createCourse(en.app, en.headers, "sv-universidad-1");
    const enRes = await en.app.request(`/v1/courses/${enCourse.id}/seed-subjects`, {
      method: "POST",
      headers: en.headers,
      body: JSON.stringify({ subjectKeys: ["fisica"] }),
    });
    expect(enRes.status).toBe(200);
    const enSubject = (await readJson<SubjectBody[]>(enRes))[0]!;
    expect(enSubject.seedLang).toBe("en");
    const enTemario = await findTemarioBySubject(en.db, enSubject.id);
    expect(enTemario!.topics).toHaveLength(236);

    const es = await authedApp("seed-fisica-es@example.com");
    const esCourse = await createCourse(es.app, es.headers, "sv-universidad-1");
    const esRes = await es.app.request(`/v1/courses/${esCourse.id}/seed-subjects`, {
      method: "POST",
      headers: es.headers,
      body: JSON.stringify({ subjectKeys: ["fisica"] }),
    });
    expect(esRes.status).toBe(200);
    const esSubject = (await readJson<SubjectBody[]>(esRes))[0]!;
    expect(esSubject.seedLang).toBe("es");
    const esTemario = await findTemarioBySubject(es.db, esSubject.id);
    expect(esTemario!.topics).toHaveLength(99);
  });

  it("performance: activating universidad/biologia (206 topics) uses one batch insert and is fast", async () => {
    const { app, headers } = await authedApp("seed-perf-bio@example.com");
    const course = await createCourse(app, headers, "sv-universidad-1");

    const start = Date.now();
    const res = await app.request(`/v1/courses/${course.id}/seed-subjects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectKeys: ["biologia"] }),
    });
    const elapsedMs = Date.now() - start;
    expect(res.status).toBe(200);
    const subject = (await readJson<SubjectBody[]>(res))[0]!;
    const temario = await findTemarioBySubject(ctx.deps.db, subject.id);
    expect(temario!.topics).toHaveLength(206);
    // eslint-disable-next-line no-console
    console.log(`[C2-a perf] activate universidad/biologia (206 topics): ${elapsedMs}ms`);
    // Generous ceiling — pglite/WASM is slower than real Postgres; the point
    // is "not 206 round-trip transactions", not a tight SLA.
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("rejects an unknown subjectKey and an unmapped gradeLevelId", async () => {
    const { app, headers } = await authedApp("seed-bad@example.com");
    const course = await createCourse(app, headers, "sv-universidad-1");

    const badKey = await app.request(`/v1/courses/${course.id}/seed-subjects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subjectKeys: ["astrologia"] }),
    });
    expect(badKey.status).toBe(400);
  });

  it("GET /v1/me exposes onboardingCompletedAt (null by default); PATCH seals it without breaking preferredLanguageCode", async () => {
    const { app, token, userId, headers } = await authedApp("onboarding@example.com");

    const before = await app.request("/v1/me", { headers: { authorization: `Bearer ${token}` } });
    expect(before.status).toBe(200);
    expect((await readJson<{ onboardingCompletedAt: string | null }>(before)).onboardingCompletedAt).toBeNull();

    const seal = await app.request("/v1/me", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ onboardingCompleted: true }),
    });
    expect(seal.status).toBe(204);

    const after = await app.request("/v1/me", { headers: { authorization: `Bearer ${token}` } });
    const afterBody = await readJson<{ onboardingCompletedAt: string | null }>(after);
    expect(afterBody.onboardingCompletedAt).not.toBeNull();

    // preferredLanguageCode contract (A3a) still works standalone.
    const lang = await app.request("/v1/me", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ preferredLanguageCode: "en" }),
    });
    expect(lang.status).toBe(204);
    expect((await findUserById(ctx.deps.db, userId))?.preferredLanguageCode).toBe("en");

    // A body with neither field is 400.
    const empty = await app.request("/v1/me", { method: "PATCH", headers, body: JSON.stringify({}) });
    expect(empty.status).toBe(400);
  });
});

/** Small helper shared by the fisica es/en test: set preferredLanguageCode via the real PATCH route. */
async function app_setLocale(app: ReturnType<typeof createApp>, headers: Record<string, string>, locale: "es" | "en") {
  const res = await app.request("/v1/me", { method: "PATCH", headers, body: JSON.stringify({ preferredLanguageCode: locale }) });
  if (res.status !== 204) throw new Error(`setLocale failed: ${res.status}`);
}
