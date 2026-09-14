/**
 * GET /v1/streak — R-4: Streak visible en F3.
 *
 * Returns the user's current streak (assessment_approved kind) with
 * opaque reason keys (B2 §9.2 — NEVER expose raw mechanics).
 * The streak is a simple count of consecutive qualifying assessments,
 * NOT of calendar days (O-7).
 *
 * Response shape:
 * ```json
 * {
 *   "current": 3,
 *   "longest": 10,
 *   "reasonKeys": ["EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS"]
 * }
 * ```
 *
 * When the user has no streak yet (no qualifying assessments), returns
 * `current: 0, longest: 0, reasonKeys: []`.
 */
import { Hono } from "hono";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { findStreak } from "../repositories/streaks";

export function createStreakRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", async (c) => {
    const userId = c.get("userId");
    const streak = await findStreak(deps.db, userId);

    if (!streak) {
      return c.json({ current: 0, longest: 0, reasonKeys: [] });
    }

    // Build reason keys based on streak state.
    // B2 §9.2: opaque i18n keys, never raw mechanics.
    const reasonKeys: string[] = [];
    if (streak.current > 0) {
      reasonKeys.push("EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS");
    }
    if (streak.current >= 3) {
      reasonKeys.push("SUSTAINED_OVER_TIME");
    }

    return c.json({
      current: streak.current,
      longest: streak.longest,
      reasonKeys,
    });
  });

  return app;
}
