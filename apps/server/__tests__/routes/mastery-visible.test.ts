/**
 * P4: `GET /v1/mastery/:subjectId` in `visible` mode — complements
 * `mastery-achievements.test.ts`'s "always 404 in F1" (shadow, default)
 * coverage, which was the only assertion this route had before P4 wired
 * stars/xp into the client. Confirms the route (routes/mastery.ts, wired in
 * P1) actually returns `stars`/`xp` once `MASTERY_VISIBILITY_MODE=visible`,
 * per plan-producto-maqueta 01-modelo-datos.md §5 ("En visible, los
 * incluye").
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody } from "../support/http-types";
import { writeMasteryState } from "../../src/repositories/mastery";

interface MasteryStateBody {
  topicKey: string;
  stars: number;
  xp: number;
  currentLevel: { tier: string };
}

describe("GET /v1/mastery/:subjectId — P4 visible mode", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("returns states with stars/xp once visibility=visible", async () => {
    ctx = await buildTestDeps({ envOverrides: { MASTERY_VISIBILITY_MODE: "visible" } });
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "mastery-visible@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Física" }) }),
    );

    await writeMasteryState(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      topicKey: "",
      level: {
        tier: "consolidated",
        positiveStreak: 2,
        negativeStreak: 0,
        strongCount: 1,
        recentStrongEvidence: [],
        lastPositiveAt: null,
        lastPromotionAt: null,
      },
      visibility: "visible",
      computedByVersion: "b2-agg-1",
      contributingAssessmentIds: [],
    });

    const res = await app.request(`/v1/mastery/${subject.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson<{ states: MasteryStateBody[] }>(res);
    expect(body.states).toHaveLength(1);
    expect(body.states[0]!.stars).toBe(2);
    expect(typeof body.states[0]!.xp).toBe("number");
  });
});
