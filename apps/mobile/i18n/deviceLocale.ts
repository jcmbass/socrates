/**
 * Device language detection (A1) — the ONLY module in the app that imports
 * `expo-localization` (native module; same isolation discipline as
 * asyncStorageLocalePrefs). Returns a BCP-47 tag ("en-US", "es-SV") or null
 * when unavailable — resolveLocale() treats null as "no signal", falling
 * back to "es".
 */
import { getLocales } from "expo-localization";

export function deviceLanguageTag(): string | null {
  try {
    return getLocales()[0]?.languageTag ?? null;
  } catch {
    return null;
  }
}