/**
 * El Salvador is a fixed UTC-6 offset with no daylight saving (DF-4 pins the
 * whole product to one country/timezone) — C-backend §2.5:
 * "`UsageQuota.resetAt`: medianoche hora de El Salvador ... explícito".
 * Pure date-key math, no `Intl`/timezone-database dependency needed for a
 * fixed offset.
 */
const EL_SALVADOR_OFFSET_MS = 6 * 60 * 60 * 1000;

function toElSalvadorLocal(date: Date): Date {
  return new Date(date.getTime() - EL_SALVADOR_OFFSET_MS);
}

/** "2026-07-12" — the El Salvador calendar day containing `date`. */
export function dailyPeriodKey(date: Date): string {
  return toElSalvadorLocal(date).toISOString().slice(0, 10);
}

/** "2026-07" — the El Salvador calendar month containing `date`. */
export function monthlyPeriodKey(date: Date): string {
  return toElSalvadorLocal(date).toISOString().slice(0, 7);
}

/** Next El Salvador midnight strictly after `date`, as a UTC ISO instant. */
export function nextDailyResetAt(date: Date): string {
  const local = toElSalvadorLocal(date);
  const nextLocalMidnight = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 0, 0, 0));
  return new Date(nextLocalMidnight.getTime() + EL_SALVADOR_OFFSET_MS).toISOString();
}

/** First El Salvador midnight of the month strictly after `date`, as a UTC ISO instant. */
export function nextMonthlyResetAt(date: Date): string {
  const local = toElSalvadorLocal(date);
  const nextLocalMonthStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1, 0, 0, 0));
  return new Date(nextLocalMonthStart.getTime() + EL_SALVADOR_OFFSET_MS).toISOString();
}
