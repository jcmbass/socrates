/**
 * P4 antifuga: `Tema.stars` is denormalized on the `temas` row (P0/P1) and
 * flows through `routes/temarios.ts` — a route surface the P1 antifuga work
 * (`routes/mastery.ts`, `routes/xp.ts`) never touched. Without a gate here,
 * any future assessor write to `temas.stars` would leak star data through
 * `GET /v1/temario/:subjectId` regardless of `MASTERY_VISIBILITY_MODE`.
 *
 * These tests write a nonzero `stars` value directly via the repository
 * (bypassing the client-write routes, which have no `stars` field in their
 * body schemas — see routes/temarios.ts's `UpdateTopicSchema` — so this is
 * the only way to get a nonzero value into a row today) and confirm the
 * route zeroes it in shadow and passes it through in visible.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody } from "../support/http-types";
import { temas } from "../../src/db/schema";

interface TopicBody {
  id: string;
  stars: number;
}
interface TemarioBody {
  topics: TopicBody[];
}

describe("GET /v1/temario/:subjectId — P4 antifuga on Tema.stars", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function authedApp(email: string, options?: Parameters<typeof buildTestDeps>[0]) {
    ctx = await buildTestDeps(options);
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Química" }) }),
    );
    const created = await readJson<TopicBody>(
      await app.request(`/v1/temario/${subject.id}/topics`, { method: "POST", headers, body: JSON.stringify({ title: "Estequiometría" }) }),
    );
    // Simulate the (not-yet-wired) assessor flow writing real stars directly on the row.
    await ctx.deps.db.update(temas).set({ stars: 3 }).where(eq(temas.id, created.id));
    return { app, headers, subject, topicId: created.id };
  }

  it("zeroes stars in shadow mode (default)", async () => {
    const { app, headers, subject } = await authedApp("temario-shadow@example.com");
    const res = await app.request(`/v1/temario/${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<TemarioBody & { visibility: string }>(res);
    expect(body.visibility).toBe("shadow");
    expect(body.topics).toHaveLength(1);
    expect(body.topics[0]!.stars).toBe(0);
  });

  it("passes the real stars value through in visible mode", async () => {
    const { app, headers, subject } = await authedApp("temario-visible@example.com", {
      envOverrides: { MASTERY_VISIBILITY_MODE: "visible" },
    });
    const res = await app.request(`/v1/temario/${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<TemarioBody & { visibility: string }>(res);
    expect(body.visibility).toBe("visible");
    expect(body.topics[0]!.stars).toBe(3);
  });

  it("zeroes stars in the reorder response too (shadow)", async () => {
    const { app, headers, subject, topicId } = await authedApp("temario-reorder-shadow@example.com");
    const res = await app.request(`/v1/temario/${subject.id}/topics/reorder`, {
      method: "POST",
      headers,
      body: JSON.stringify({ orderedIds: [topicId] }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<TopicBody[]>(res);
    expect(body[0]!.stars).toBe(0);
  });
});
