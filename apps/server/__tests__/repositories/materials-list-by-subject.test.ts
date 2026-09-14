/**
 * Repository-level isolation for listMaterialsBySubject — the userId
 * filter must be load-bearing even when the route already checked subject
 * ownership (defense in depth).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import { listMaterialsBySubject } from "../../src/repositories/materials";

describe("listMaterialsBySubject — repository userId filter", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("returns empty when userId does not own the subject's materials", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token: tokenA, userId: userIdA } = await signupAndVerify(app, ctx.deps, "repo-a@example.com");
    const headersA = { authorization: `Bearer ${tokenA}`, "content-type": "application/json" };
    const course = await readJson<{ id: string }>(
      await app.request("/v1/courses", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }),
      }),
    );
    const subject = await readJson<{ id: string }>(
      await app.request("/v1/subjects", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({ courseId: course.id, name: "Álgebra" }),
      }),
    );
    const material = await readJson<{ id: string }>(
      await app.request("/v1/materials", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({ kind: "paste", subjectId: subject.id, text: "secreto de A" }),
      }),
    );

    const { userId: userIdB } = await signupAndVerify(app, ctx.deps, "repo-b@example.com");

    const asOwner = await listMaterialsBySubject(ctx.deps.db, userIdA, subject.id);
    expect(asOwner.map((m) => m.id)).toContain(material.id);

    const asOther = await listMaterialsBySubject(ctx.deps.db, userIdB, subject.id);
    expect(asOther).toEqual([]);
    expect(asOther.map((m) => m.id)).not.toContain(material.id);
  });
});
