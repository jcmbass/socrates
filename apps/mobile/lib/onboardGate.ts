/**
 * Onboarding gate — D-C07 (C2-c). Used to derive "needs onboarding" from
 * "has zero ACTIVE courses" (P3), but that gate is wrong for the beta:
 * testers enrolled before this feature already have an active course, so
 * they would NEVER see the new seed-subjects onboarding. `GET /v1/me` now
 * carries `onboardingCompletedAt` (null until the wizard seals it via
 * `completeOnboarding()`) — that is the real signal.
 *
 * Pure so it's testable without touching the network — `courses/index.tsx`
 * calls this right after `GET /v1/me` resolves and redirects into
 * `/onboard/paso-1-grados` instead of rendering home.
 */
import type { MeResult } from "./api/types";

export function needsOnboarding(me: Pick<MeResult, "onboardingCompletedAt">): boolean {
  return me.onboardingCompletedAt === null;
}
