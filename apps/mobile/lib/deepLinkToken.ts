/**
 * Deep-link token normalization — F2 WQ4 (login por deep-link).
 *
 * expo-router's `useLocalSearchParams` types every query param as
 * `string | string[] | undefined` (a route can be matched with a repeated
 * `?token=a&token=b`, or omit the param entirely). `buxo://login?token=...`
 * and the emailed `MAGIC_LINK_BASE_URL=buxo://login?token=...` link only
 * ever produce a single value in practice, but the type — and a malformed
 * or hand-crafted link — don't guarantee that. Pure so it's unit-testable
 * without pulling expo-router into the vitest/node suite.
 */

/** Normalizes an expo-router search param to a single trimmed token, or null if absent/empty/malformed. */
export function normalizeDeepLinkToken(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
