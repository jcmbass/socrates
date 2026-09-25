/**
 * Client → server locale sync (A1, AJUSTE 1 del arquitecto).
 *
 * The student's EFFECTIVE UI locale is written to
 * `users.preferredLanguageCode` (server default "es") at three moments:
 *  (a) when the language selector changes (i18n/react.tsx setOverride),
 *  (b) cuando el login/signup termina y el token aparece en el store,
 *  (c) una vez por arranque de app con sesión ya guardada.
 * (b) y (c) son el mismo efecto del provider — ver el docblock de
 * i18n/react.tsx; `shouldSyncPreferredLanguage` guarda el "una vez".
 *
 * La cuenta nace con la locale correcta desde el signup
 * (`client.ts#signup` manda `preferredLanguageCode`); esto es la red de
 * seguridad para todo lo demás: cuentas viejas, enrolamiento por deep-link
 * (que no tiene formulario ni señal de idioma) y cambios de idioma después.
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

/** Lo último que ESTE arranque de la app le dejó dicho al server. */
export interface PreferredLanguageSyncMark {
  token: string;
  locale: "es" | "en";
}

/**
 * Whether a sync should fire: only once per (sesión de auth, locale efectivo)
 * — el selector (a) y el login (b) sincronizan de inmediato, así que repetir
 * el disparo con el mismo token y la misma locale es spam.
 *
 * El TOKEN es parte de la llave a propósito (bug del 2026-09-18): deduplicar
 * solo por locale hacía que un logout + login de OTRA cuenta sin cerrar la
 * app no sincronizara nada — la cuenta nueva se quedaba con la locale que
 * tuviera guardada (típicamente "es") hasta el siguiente arranque en frío.
 * El PATCH escribe en la fila del dueño del token, así que "ya sincronicé
 * 'en'" no dice nada sobre una fila distinta.
 */
export function shouldSyncPreferredLanguage(
  lastSynced: PreferredLanguageSyncMark | null,
  next: PreferredLanguageSyncMark,
): boolean {
  if (!lastSynced) return true;
  return lastSynced.token !== next.token || lastSynced.locale !== next.locale;
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