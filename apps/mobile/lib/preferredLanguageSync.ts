/**
 * Client → server locale sync (A1, AJUSTE 1 del arquitecto).
 *
 * The student's EFFECTIVE UI locale is written to
 * `users.preferredLanguageCode` (server default "es") at three moments:
 *  (a) when the language selector changes (i18n/react.tsx setOverride),
 *  (b) after login/signup completes (app/login.tsx verify success),
 *  (c) once per app start when already authenticated and the effective
 *      locale differs from what we last synced this session
 *      (`shouldSyncPreferredLanguage` guards the "once").
 *
 * PURE + dependency-injected (the client is a parameter, mirroring
 * lib/api/client.ts's discipline) so this is unit-testable offline. The
 * sync is FIRE-AND-FORGET with a soft retry: it NEVER throws, NEVER blocks
 * the UI, and never surfaces an error — a failed sync costs at most a
 * stale server-side language until the next trigger (c) retries it.
 *
 * The server endpoint (PATCH /v1/me) landed in phase A3a; before that every
 * request 404'd and this module was a polite no-op. The retry contract is
 * kept unchanged — it now absorbs 401/network instead of the old 404.
 */
export type PreferredLanguageSyncClient = {
  updatePreferredLanguage(token: string, locale: "es" | "en"): Promise<void>;
};

export interface SyncAttempts {
  /** Total attempts (1 = no retry). Default 2 — "retry suave". */
  attempts?: number;
  /** Base delay between attempts, ms. Default 1500. */
  retryDelayMs?: number;
  /** Test seam — defaults to setTimeout. */
  delay?(ms: number): Promise<void>;
}

const DEFAULT_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 1500;

/**
 * Whether an app-start sync (moment c) should fire: only once per effective
 * locale per session — the selector (a) and login (b) sync eagerly, so
 * repeat triggers with an unchanged locale are spam.
 */
export function shouldSyncPreferredLanguage(lastSynced: "es" | "en" | null, locale: "es" | "en"): boolean {
  return lastSynced !== locale;
}

/** Resolves to true on success; false when every attempt failed. Never throws. */
export async function syncPreferredLanguage(
  client: PreferredLanguageSyncClient,
  token: string,
  locale: "es" | "en",
  opts: SyncAttempts = {},
): Promise<boolean> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
  const delay = opts.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await client.updatePreferredLanguage(token, locale);
      return true;
    } catch {
      // Deliberately swallowed: 404 (endpoint pending A3), 401, network —
      // all mean "try again next trigger", never "tell the student".
      if (attempt < attempts) await delay(opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    }
  }
  return false;
}