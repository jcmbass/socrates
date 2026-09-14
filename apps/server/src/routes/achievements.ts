/**
 * GET /v1/achievements — R-4: Achievement/score en sombra hasta F4.
 *
 * Student route: always 404 (same pattern as `routes/mastery.ts` — never
 * distinguishes "no achievements" from "not visible").
 *
 * GET /:subjectId/inspect — founder-only (accountKind === "internal_dev"):
 * returns all Achievement rows for the caller's subject, plus active
 * challenge definitions. Same ownership scoping as mastery inspect.
 *
 * DEVIATION (same as mastery inspect): scoped to the CALLING internal_dev's
 * own subjects, not cross-user. Revisit if real cross-user auditing is
 * needed before F4 shadow-exit.
 */
import { Hono } from "hono";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";
import { findSubjectById } from "../repositories/subjects";
import { findUserById } from "../repositories/users";
import { listByUserAndSubject } from "../repositories/achievements";
import { listAllActive } from "../repositories/challenge-definitions";

export function createAchievementsRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Student route: always 404 (shadow until F4).
  app.get("/", async (c) => {
    return errorResponse(c, "not_found", "Not found");
  });

  // Founder-only inspect.
  app.get("/:subjectId/inspect", async (c) => {
    const userId = c.get("userId");
    const notFound = () => errorResponse(c, "not_found", "Not found");

    const user = await findUserById(deps.db, userId);
    if (!user || user.accountKind !== "internal_dev") return notFound();

    const subjectId = c.req.param("subjectId");
    const subject = await findSubjectById(deps.db, subjectId);
    if (!subject || subject.userId !== userId) return notFound();

    const achievements = await listByUserAndSubject(deps.db, userId, subjectId);
    const definitions = await listAllActive(deps.db);

    return c.json({ achievements, definitions });
  });

  return app;
}
