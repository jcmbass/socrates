/**
 * Streak helpers — pure logic for streak state, formatting, and display.
 *
 * PURE (no react-native import) so this logic is offline-testable under plain
 * vitest/node, same discipline as lib/transcriptEvents.ts.
 *
 * The streak represents consecutive "explain in your own words" assessments
 * (R-4). The copy never describes the assessor mechanics — it talks about
 * consistency and practice (B2 §9.2).
 */
import { getStrings } from "../i18n";
import type { StreakResult } from "./api/types";

/** Three visual states the streak surface can be in. */
export type StreakState = "none" | "active" | "broken";

/**
 * Derive the visual state from the server's streak data.
 *
 * - `current === 0 && longest === 0` → never had a streak ("none")
 * - `current > 0` → currently active
 * - `current === 0 && longest > 0` → had one but lost it ("broken")
 */
export function streakState(streak: StreakResult | null): StreakState {
  if (!streak || (streak.current === 0 && streak.longest === 0)) return "none";
  if (streak.current > 0) return "active";
  return "broken";
}

/**
 * Human-readable streak count label.
 * Returns just the number — the unit is rendered by the component.
 * Empty string when there is no streak.
 */
export function formatStreakCount(current: number): string {
  if (current <= 0) return "";
  return String(current);
}

/**
 * Returns a short reason string for the streak, based on the server's
 * opaque reason keys (B2 §9.2). Returns null when there are no reasons
 * (no streak or streak just started).
 */
export function streakReason(reasonKeys: string[]): string | null {
  if (reasonKeys.length === 0) return null;
  // A1 — the two reason strings moved into the catalog
  // (courses.streak.reasons; they were the audit's ONE sanctioned
  // hardcoded-string exception). Read at call time so the copy follows the
  // active locale without a React subscription in this pure module.
  const reasons = getStrings().courses.streak.reasons;
  // The first key is the most descriptive for the student-facing surface.
  // "EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS" → consistent practice.
  if (reasonKeys.includes("EXPLAINED_IN_OWN_WORDS_ACROSS_SESSIONS")) {
    return reasons.explainedAcrossSessions;
  }
  if (reasonKeys.includes("SUSTAINED_OVER_TIME")) {
    return reasons.sustainedOverTime;
  }
  return null;
}
