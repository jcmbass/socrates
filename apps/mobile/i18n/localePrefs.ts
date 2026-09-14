/**
 * Locale override persistence (A1).
 *
 * SAME discipline as lib/asyncStorageLocalStore.ts, mirrored: the PURE
 * interface + in-memory double live here (unit-testable under vitest/node)
 * and the AsyncStorage binding is a separate module
 * (`asyncStorageLocalePrefs.ts`) so nothing under test imports the native
 * module.
 *
 * Why NOT inside the app store's PersistedAppState blob: `logout()` clears
 * that store (`local.clear()`) — a language choice is a device-level
 * preference, not session data; losing it on logout would silently flip an
 * English-speaking student back to device default.
 */
import type { LocaleOverride } from "./index";

export const LOCALE_OVERRIDE_KEY = "socrates.locale.override";

export interface LocalePrefsStore {
  /** `null` when nothing (or nothing valid) is stored — reads as "Automático". */
  load(): Promise<LocaleOverride>;
  save(value: LocaleOverride): Promise<void>;
}

function parseOverride(raw: string | null): LocaleOverride {
  if (raw === "es" || raw === "en") return raw;
  return null;
}

/** Test/dev double. Round-trips through the same string shape as storage. */
export class InMemoryLocalePrefsStore implements LocalePrefsStore {
  private blob: string | null = null;

  load(): Promise<LocaleOverride> {
    return Promise.resolve(parseOverride(this.blob));
  }

  save(value: LocaleOverride): Promise<void> {
    this.blob = value === null ? null : value;
    return Promise.resolve();
  }
}