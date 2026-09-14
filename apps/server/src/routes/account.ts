/**
 * DELETE /v1/account and GET /v1/account/export — C-backend §2.4/§5.3/A7.
 *
 * Deletes the caller's sessions, exchanges, materials, fuentes, courses,
 * and subjects in the same request, then tombstones the user row and
 * pseudonymizes consents (R-8). Status stays 202. Object-storage bytes are
 * still out of scope until DF-6 storage is wired.
 */
import { Hono } from "hono";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";
import { findUserById } from "../repositories/users";
import { listConsentsByUser } from "../repositories/consents";
import { listCoursesByUser } from "../repositories/courses";
import { listSubjectsByUser } from "../repositories/subjects";
import { listMaterialsByUser } from "../repositories/materials";
import { listAllStudySessionsByUser } from "../repositories/study-sessions";
import { listExchangesBySession } from "../repositories/exchanges";
import { listReadySessionOpeningsBySessionIds } from "../repositories/session-openings";
import { deleteAccountAndPurge } from "../repositories/account-purge";

export function createAccountRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.delete("/", async (c) => {
    const userId = c.get("userId");
    const user = await findUserById(deps.db, userId);
    if (!user) return errorResponse(c, "not_found", "User not found");

    await deleteAccountAndPurge(deps.db, userId, deps.sessionDeps.secret);

    return c.body(null, 202);
  });

  app.get("/export", async (c) => {
    const userId = c.get("userId");
    const user = await findUserById(deps.db, userId);
    if (!user) return errorResponse(c, "not_found", "User not found");

    const [courses, subjects, materials, sessions, consents] = await Promise.all([
      listCoursesByUser(deps.db, userId),
      listSubjectsByUser(deps.db, userId),
      listMaterialsByUser(deps.db, userId),
      listAllStudySessionsByUser(deps.db, userId),
      listConsentsByUser(deps.db, userId),
    ]);

    const openings = await listReadySessionOpeningsBySessionIds(
      deps.db,
      sessions.map((session) => session.id),
    );
    const openingBySessionId = new Map(openings.map((opening) => [opening.sessionId, opening]));
    const sessionsWithExchanges = await Promise.all(
      sessions.map(async (session) => ({
        ...session,
        exchanges: await listExchangesBySession(deps.db, session.id),
        opening: openingBySessionId.get(session.id) ?? null,
      })),
    );

    return c.json({
      exportedAt: new Date().toISOString(),
      user,
      courses,
      subjects,
      materials,
      sessions: sessionsWithExchanges,
      consents,
    });
  });

  return app;
}
