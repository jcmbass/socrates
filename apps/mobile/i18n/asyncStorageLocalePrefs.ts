/**
 * AsyncStorage binding for the locale override (A1) — kept in its own module
 * so nothing vitest touches imports the native module (same pattern as
 * lib/asyncStorageLocalStore.ts). Consumed ONLY by i18n/react.tsx.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { LOCALE_OVERRIDE_KEY, type LocalePrefsStore } from "./localePrefs";
import type { LocaleOverride } from "./index";

function parseOverride(raw: string | null): LocaleOverride {
  if (raw === "es" || raw === "en") return raw;
  return null;
}

export const asyncStorageLocalePrefsStore: LocalePrefsStore = {
  async load(): Promise<LocaleOverride> {
    try {
      return parseOverride(await AsyncStorage.getItem(LOCALE_OVERRIDE_KEY));
    } catch {
      // Site data blocked / storage unavailable — degrade to "Automático".
      return null;
    }
  },

  async save(value: LocaleOverride): Promise<void> {
    try {
      if (value === null) await AsyncStorage.removeItem(LOCALE_OVERRIDE_KEY);
      else await AsyncStorage.setItem(LOCALE_OVERRIDE_KEY, value);
    } catch {
      // Persisting the preference is best-effort; the session keeps working.
    }
  },
};