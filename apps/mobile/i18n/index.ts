/**
 * Locale catalog + resolution (A1 localization).
 *
 * Reactive consumers (screens/components) use the `useT()` hook from
 * `i18n/react.tsx` (LocaleContext → re-renders on switch). Pure lib modules
 * (`lib/turnErrorCopy.ts`, `lib/ingestErrorCopy.ts`, …) can't hold hooks —
 * they read the ACTIVE catalog through `getStrings()` at call time; the
 * provider keeps `setActiveLocale` in sync with React state, and because
 * those helpers are invoked during render, the copy follows the locale
 * without any subscription of their own.
 *
 * Resolution precedence (A0 plan, AJUSTE del arquitecto): manual override >
 * device language > "es". Only es/en are supported today — ANY other device
 * language (pt-BR, fr, …) falls back to "es", the app's founding locale.
 */
import { es } from "./es";
import { en } from "./en";

export type Strings = typeof es;

/** Locales with a catalog. A2 fills `en` with real English copy. */
export type Locale = "es" | "en";

/**
 * The stored preference: a forced locale, or `null` = "Automático
 * (dispositivo)" — follow the device each launch. `undefined` is NOT part of
 * this type: storage absence reads as `null`.
 */
export type LocaleOverride = Locale | null;

export const DEFAULT_LOCALE: Locale = "es";

export const LOCALES: readonly Locale[] = ["es", "en"] as const;

const catalogs: Record<Locale, Strings> = { es, en };

/** Catalog for an EXPLICIT locale (reactive path — `useT()` knows its locale from context). */
export function getLocaleStrings(locale: Locale): Strings {
  return catalogs[locale];
}

// --- Active-catalog mirror for non-reactive (pure lib) consumers ----------

let activeLocale: Locale = DEFAULT_LOCALE;

/** Catalog of the active locale — call DURING render/invocation, never cache at module scope. */
export function getStrings(): Strings {
  return catalogs[activeLocale];
}

/** Kept in sync by the LocaleProvider (and tests). Not reactive by itself. */
export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

/** Test/edge convenience — `activeLocale` has no other reader. */
export function getActiveLocale(): Locale {
  return activeLocale;
}

// --- Resolution ------------------------------------------------------------

/**
 * `deviceLang` is a BCP-47 tag or bare language ("en-US", "es-SV", "en").
 * Precedence: override > device > default. Unsupported device languages
 * (anything not `en*`) fall back to "es" — never to a missing catalog.
 */
export function resolveLocale(deviceLang: string | null | undefined, override: LocaleOverride): Locale {
  if (override !== null) return override;
  if (deviceLang && deviceLang.toLowerCase().startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}