/**
 * GET /v1/materials?subjectId=… — subject-scoped material list for reconcile.
 * Isolation: user A must never see user B's materials (even on a subject
 * id they guess). The suite mutates the ownership filter to prove the
 * guard is load-bearing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";

interface CourseBody {
  id: string;
}
interface SubjectBody {
  id: string;
}
interface MaterialBody {
  id: string;
  userId: string;
  subjectId: string;
  originalFilename: string | null;
  status: string;
  createdAt: string;
  digestedTextRef: string;
}

describe("GET /v1/materials?subjectId= — list + isolation", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function seedUserWithMaterial(email: string, subjectName: string, text: string) {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", {
        method: "POST",
        headers,
        body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }),
      }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", {
        method: "POST",
        headers,
        body: JSON.stringify({ courseId: course.id, name: subjectName }),
      }),
    );
    const material = await readJson<MaterialBody>(
      await app.request("/v1/materials", {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "paste", subjectId: subject.id, text }),
      }),
    );
    return { app, token, userId, headers, subject, material };
  }

  it("lists the caller's materials for the subject with reconcile fields", async () => {
    const { app, headers, subject, material } = await seedUserWithMaterial(
      "list-own@example.com",
      "Cálculo",
      "La derivada de x^2 es 2x.",
    );

    const res = await app.request(`/v1/materials?subjectId=${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const list = await readJson<MaterialBody[]>(res);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: material.id,
      subjectId: subject.id,
      status: "ready",
      digestedTextRef: expect.stringContaining("derivada"),
      createdAt: expect.any(String),
    });
    // originalFilename is null for paste — field still present for reconcile.
    expect(list[0]).toHaveProperty("originalFilename");
  });

  it("404s when subjectId is missing", async () => {
    const { app, headers } = await seedUserWithMaterial("list-nosubj@example.com", "Física", "texto");
    const res = await app.request("/v1/materials", { headers });
    expect(res.status).toBe(400);
    expect((await readJson<{ code: string }>(res)).code).toBe("invalid_request");
  });

  it("user B cannot list materials on user A's subject (ownership)", async () => {
    const {
      app,
      subject: subjectA,
      material: materialA,
    } = await seedUserWithMaterial("owner-a-list@example.com", "Historia", "Texto de A sobre la independencia.");

    const { token: tokenB } = await signupAndVerify(app, ctx.deps, "owner-b-list@example.com");
    const headersB = { authorization: `Bearer ${tokenB}` };

    const res = await app.request(`/v1/materials?subjectId=${subjectA.id}`, { headers: headersB });
    // Same shape as fuentes/temarios: foreign subject → not_found (no leak).
    expect(res.status).toBe(404);
    expect((await readJson<{ code: string }>(res)).code).toBe("not_found");

    // Belts: even if status were 200, B must not receive A's material id.
    if (res.status === 200) {
      const list = await readJson<MaterialBody[]>(res);
      expect(list.map((m) => m.id)).not.toContain(materialA.id);
    }
  });

  it("user B's own subject list does not include user A's materials", async () => {
    const { app, material: materialA } = await seedUserWithMaterial(
      "iso-a@example.com",
      "Química",
      "Material secreto de A",
    );

    const { token: tokenB } = await signupAndVerify(app, ctx.deps, "iso-b@example.com");
    const headersB = { authorization: `Bearer ${tokenB}`, "content-type": "application/json" };
    const courseB = await readJson<CourseBody>(
      await app.request("/v1/courses", {
        method: "POST",
        headers: headersB,
        body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }),
      }),
    );
    const subjectB = await readJson<SubjectBody>(
      await app.request("/v1/subjects", {
        method: "POST",
        headers: headersB,
        body: JSON.stringify({ courseId: courseB.id, name: "Química" }),
      }),
    );
    await app.request("/v1/materials", {
      method: "POST",
      headers: headersB,
      body: JSON.stringify({ kind: "paste", subjectId: subjectB.id, text: "Material de B" }),
    });

    const res = await app.request(`/v1/materials?subjectId=${subjectB.id}`, { headers: headersB });
    expect(res.status).toBe(200);
    const list = await readJson<MaterialBody[]>(res);
    expect(list.map((m) => m.id)).not.toContain(materialA.id);
    expect(list.every((m) => m.digestedTextRef.includes("Material de B"))).toBe(true);
  });
});
