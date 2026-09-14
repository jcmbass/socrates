/**
 * Route-level tests for fuentes — Fase P1 auth scope.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody } from "../support/http-types";

interface FuenteBody {
  id: string;
  name: string;
  text: string;
  kind: string;
}

describe("GET/POST /v1/fuentes/:subjectId — P1 auth scope", () => {
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
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Biología" }) }),
    );
    return { app, token, headers, subject };
  }

  it("creates and lists fuentes scoped to the subject", async () => {
    const { app, headers, subject } = await authedApp("fuentes-owner@example.com");
    const res = await app.request(`/v1/fuentes/${subject.id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "guia.pdf", kind: "pdf", text: "La célula." }),
    });
    expect(res.status).toBe(201);
    const fuente = await readJson<FuenteBody>(res);
    expect(fuente.text).toBe("La célula.");

    const list = await app.request(`/v1/fuentes/${subject.id}`, { headers });
    expect(await readJson<FuenteBody[]>(list)).toHaveLength(1);
  });

  it("returns 404 when another user accesses the subject's fuentes", async () => {
    const { app: appA, subject } = await authedApp("fuentes-a@example.com");
    const { token: tokenB } = await signupAndVerify(appA, ctx.deps, "fuentes-b@example.com");

    const res = await appA.request(`/v1/fuentes/${subject.id}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "x", kind: "pdf", text: "x" }),
    });
    expect(res.status).toBe(404);
  });
});
