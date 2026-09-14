import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";

interface CourseBody {
  id: string;
  gradeLevelId: string;
  status: string;
}
interface SubjectBody {
  id: string;
  name: string;
}
interface MaterialBody {
  id: string;
  status: string;
  kind: string;
  digestedTextRef: string;
}

describe("courses / subjects / materials — API contract happy paths + error shapes", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function authedApp(email: string) {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, email);
    return { app, token, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } };
  }

  it("creates a course against an ENABLED grade level (bachillerato) and sets it as currentCourseId", async () => {
    const { app, headers } = await authedApp("courses@example.com");

    const res = await app.request("/v1/courses", {
      method: "POST",
      headers,
      body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }),
    });
    expect(res.status).toBe(201);
    const course = await readJson<CourseBody>(res);
    expect(course.gradeLevelId).toBe("sv-bachillerato-1");
    expect(course.status).toBe("active");

    const list = await app.request("/v1/courses", { headers });
    expect(await readJson<CourseBody[]>(list)).toHaveLength(1);
  });

  it("I-7: rejects a course against a DISABLED grade level (básica, not enabled in etapa 1)", async () => {
    const { app, headers } = await authedApp("i7@example.com");
    const res = await app.request("/v1/courses", {
      method: "POST",
      headers,
      body: JSON.stringify({ gradeLevelId: "sv-basica-1" }),
    });
    expect(res.status).toBe(400);
    expect((await readJson<{ code: string }>(res)).code).toBe("invalid_request");
  });

  it("creates a subject under a course the caller owns, sanitizing the free-text name (R6)", async () => {
    const { app, headers } = await authedApp("subjects@example.com");
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );

    const res = await app.request("/v1/subjects", {
      method: "POST",
      headers,
      body: JSON.stringify({ courseId: course.id, name: "  Historia\n\nde El Salvador  " }),
    });
    expect(res.status).toBe(201);
    const subject = await readJson<SubjectBody>(res);
    expect(subject.name).toBe("Historia de El Salvador");

    const list = await app.request(`/v1/subjects?courseId=${course.id}`, { headers });
    expect(await readJson<SubjectBody[]>(list)).toHaveLength(1);
  });

  it("404s creating a subject under another user's course (ownership check)", async () => {
    const { app: appA, headers: headersA } = await authedApp("owner-a@example.com");
    const course = await readJson<CourseBody>(
      await appA.request("/v1/courses", { method: "POST", headers: headersA, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );

    // Second user, same app/db.
    const { token: tokenB } = await signupAndVerify(appA, ctx.deps, "owner-b@example.com");
    const res = await appA.request("/v1/subjects", {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      body: JSON.stringify({ courseId: course.id, name: "Matemática" }),
    });
    expect(res.status).toBe(404);
  });

  it("materials: kind:paste digests synchronously to status:ready", async () => {
    const { app, headers } = await authedApp("materials@example.com");
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Cálculo" }) }),
    );

    const res = await app.request("/v1/materials", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "paste", subjectId: subject.id, text: "La derivada de x^2 es 2x." }),
    });
    expect(res.status).toBe(201);
    const material = await readJson<MaterialBody>(res);
    expect(material.status).toBe("ready");
    expect(material.digestedTextRef).toContain("La derivada");

    const getRes = await app.request(`/v1/materials/${material.id}`, { headers });
    expect(getRes.status).toBe(200);
    expect((await readJson<MaterialBody>(getRes)).id).toBe(material.id);
  });

  it("materials: a multipart PHOTO upload is accepted but stays status:pending (C4 photo/txt digestion is out of scope for F2 WQ1 — flagged deviation)", async () => {
    const { app, headers } = await authedApp("multipart@example.com");
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Física" }) }),
    );

    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("file", new File([new Uint8Array([1, 2, 3])], "notes.png", { type: "image/png" }));

    const res = await app.request("/v1/materials", {
      method: "POST",
      headers: { authorization: headers.authorization },
      body: form,
    });
    expect(res.status).toBe(201);
    const material = await readJson<MaterialBody>(res);
    expect(material.status).toBe("pending");
    expect(material.kind).toBe("photo");
  });

  it("materials: a multipart PDF upload with garbage bytes is rejected cleanly (F2 WQ1 activates real digestion — see materials-pdf-pipeline.test.ts for the real-PDF flows)", async () => {
    const { app, headers } = await authedApp("multipart-badpdf@example.com");
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Física" }) }),
    );

    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("file", new File([new Uint8Array([1, 2, 3])], "notes.pdf", { type: "application/pdf" }));

    const res = await app.request("/v1/materials", {
      method: "POST",
      headers: { authorization: headers.authorization },
      body: form,
    });
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; code: string }>(res);
    expect(body.code).toBe("invalid_request");
  });

  it("returns the uniform { error, code } shape on a 404", async () => {
    const { app, headers } = await authedApp("errshape@example.com");
    const res = await app.request("/v1/materials/does-not-exist", { headers });
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body).toEqual({ error: expect.any(String), code: "not_found" });
  });
});
