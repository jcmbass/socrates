/**
 * GET /v1/activity — A-producto-ux §5.2: señales honestas de actividad.
 *
 * Exposes what A §5.2 proposes, using data that is NOT from the assessor
 * (O-5: "cero números del assessor"). Currently returns:
 * - `recentSessionCount`: number of study sessions in the last N days
 * - `totalExchangeCount`: total exchanges across all sessions
 * - `streak`: current and longest streak (from the streak table)
 *
 * These are derived from session/exchange/streak data, never from
 * mastery levels, assessor verdicts, or any other calibrated signal.
 * The activity endpoint is shadow in F3 (not exposed to the student UI
 * until F4), but the route exists so the mobile team can wire the screen.
 */
import { Hono } from "hono";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { listActiveStudySessions } from "../repositories/study-sessions";
import { listExchangesBySession } from "../repositories/exchanges";
import { findStreak } from "../repositories/streaks";

export function createActivityRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", async (c) => {
    const userId = c.get("userId");

    const sessions = await listActiveStudySessions(deps.db, userId);
    const recentSessionCount = sessions.length;

    // Total exchanges across all sessions.
    let totalExchangeCount = 0;
    for (const session of sessions) {
      const exchanges = await listExchangesBySession(deps.db, session.id);
      totalExchangeCount += exchanges.length;
    }

    const streak = await findStreak(deps.db, userId);

    return c.json({
      recentSessionCount,
      totalExchangeCount,
      streak: streak
        ? { current: streak.current, longest: streak.longest }
        : { current: 0, longest: 0 },
    });
  });

  return app;
}
