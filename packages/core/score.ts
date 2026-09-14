import type { Band } from "./prompts";

/**
 * Per-band independence score (design doc MVP scope item #4):
 * independence = 1 - hints_offered / turns.
 *
 * `turns` here means student turns whose judge flag came back (not null).
 * Turns where the judge call failed carry hintOffered === null and must be
 * excluded from BOTH the numerator and the denominator — a failed judge
 * call is not evidence of independence either way.
 */
export interface ScoredTurn {
  band: Band;
  hintOffered: boolean | null;
}

export function computeIndependenceScore(turns: ScoredTurn[]): number | null {
  const eligible = turns.filter((t) => t.hintOffered !== null);
  if (eligible.length === 0) return null;
  const hints = eligible.filter((t) => t.hintOffered === true).length;
  return 1 - hints / eligible.length;
}

export function computeIndependenceScoreByBand(
  turns: ScoredTurn[],
): Record<Band, number | null> {
  const bands: Band[] = ["guiding", "probing", "minimal"];
  const result = {} as Record<Band, number | null>;
  for (const band of bands) {
    result[band] = computeIndependenceScore(
      turns.filter((t) => t.band === band),
    );
  }
  return result;
}

/** "—" for 0 eligible turns (never NaN, never a bare 0/100 that implies data). */
export function formatScore(score: number | null): string {
  if (score === null) return "—";
  return `${Math.round(score * 100)}%`;
}
