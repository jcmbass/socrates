/**
 * LocaleContext + `useT()` (A1 localization) — the reactive half of the
 * i18n migration. Screens call `const t = useT();` and re-render whenever
 * the locale changes; pure lib helpers read the SAME catalog through
 * `getStrings()` (i18n/index.ts), kept in lock-step by the provider.
 *
 * Precedence (A0): stored override > device language (expo-localization,
 * isolated in i18n/deviceLocale.ts) > "es". The override persists in
 * AsyncStorage SEPARATELY from the auth blob (localePrefs.ts) because
 * `logout()` clears the auth store and a language choice is a device
 * preference, not session data.
 *
 * Server sync (AJUSTE 1): every effective-locale change PATCHes
 * /v1/me fire-and-forget (lib/preferredLanguageSync.ts) — moments (a)
 * selector change and (c) once per start when authenticated. Moment (b)
 * post-login lives in app/login.tsx (the provider isn't mounted around the
 * login flow's token acquisition order).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { apiClient } from "../lib/api/expoClient";
import {
  shouldSyncPreferredLanguage,
  syncPreferredLanguage,
} from "../lib/preferredLanguageSync";
import { useAppState } from "../lib/appStore";
import { asyncStorageLocalePrefsStore } from "./asyncStorageLocalePrefs";
import { deviceLanguageTag } from "./deviceLocale";
import {
  DEFAULT_LOCALE,
  getLocaleStrings,
  getStrings,
  resolveLocale,
  setActiveLocale,
  type Locale,
  type LocaleOverride,
  type Strings,
} from "./index";

interface LocaleContextValue {
  /** Effective locale — what `useT()` returns copy for. */
  locale: Locale;
  /** Stored choice; `null` = "Automático (dispositivo)". */
  override: LocaleOverride;
  /** Selecting "Automático" passes `null`. Persists + syncs to the server. */
  setOverride(next: LocaleOverride): void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** Storage/detection backends — overridable only for tests via the provider factory. */
interface ProviderDeps {
  prefs: Pick<typeof asyncStorageLocalePrefsStore, "load" | "save">;
  deviceLang(): string | null;
}

const defaultDeps: ProviderDeps = {
  prefs: asyncStorageLocalePrefsStore,
  deviceLang: deviceLanguageTag,
};

export function LocaleProvider({ children }: { children: ReactNode }) {
  return <LocaleProviderBody {...defaultDeps}>{children}</LocaleProviderBody>;
}

function LocaleProviderBody({ children, prefs, deviceLang }: { children: ReactNode } & ProviderDeps) {
  const auth = useAppState((s) => s.auth);
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [override, setOverrideState] = useState<LocaleOverride>(null);
  const [resolved, setResolved] = useState(false);
  // Last locale successfully handed to the server this session — dedupes
  // the app-start sync (moment c) and keeps selector churn cheap.
  const lastSyncedRef = useRef<"es" | "en" | null>(null);

  const syncToServer = useCallback(
    (next: Locale, token: string | null | undefined) => {
      if (!token) return;
      if (!shouldSyncPreferredLanguage(lastSyncedRef.current, next)) return;
      void syncPreferredLanguage(apiClient, token, next).then((ok) => {
        if (ok) lastSyncedRef.current = next;
      });
    },
    [],
  );

  // Hydrate: stored override > device language > default. Until this
  // resolves the app renders "es" (the founding locale — no flash for the
  // overwhelming majority of the beta), mirroring the fonts/hydration gate
  // in app/_layout.tsx.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await prefs.load();
      if (cancelled) return;
      const next = resolveLocale(deviceLang(), stored);
      setActiveLocale(next);
      setOverrideState(stored);
      setLocaleState(next);
      setResolved(true);
      syncToServer(next, auth?.token);
    })();
    return () => {
      cancelled = true;
    };
    // Runs ONCE per mount. `auth` is read at resolution time — moment (c)
    // for sessions resumed from storage; fresh logins sync via (b) + the
    // token effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Moment (c) redux + login race: a token can appear AFTER hydration
  // (login completing while the app runs). When it does and the effective
  // locale was never synced with it, sync once.
  useEffect(() => {
    if (!resolved || !auth?.token) return;
    syncToServer(locale, auth.token);
  }, [auth?.token, resolved, locale, syncToServer]);

  const setOverride = useCallback(
    (next: LocaleOverride) => {
      const effective = resolveLocale(deviceLang(), next);
      setActiveLocale(effective);
      setOverrideState(next);
      setLocaleState(effective);
      setResolved(true);
      void prefs.save(next);
      syncToServer(effective, auth?.token);
    },
    [auth?.token, deviceLang, prefs, syncToServer],
  );

  const value = useMemo(() => ({ locale, override, setOverride }), [locale, override, setOverride]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * The reactive strings accessor — `const t = useT();` replaces the A0-era
 * `import { t } from "../i18n/es"` in every screen/component. Subscribes to
 * LocaleContext, so a locale switch re-renders exactly the mounted
 * consumers.
 */
export function useT(): Strings {
  const ctx = useContext(LocaleContext);
  // Provider sits at the root (app/_layout.tsx) — a null ctx is a wiring
  // bug, not a runtime state. Fall back to the default catalog so the
  // screen still renders Spanish instead of crashing.
  return ctx ? getLocaleStrings(ctx.locale) : getStrings();
}

/**
 * Full locale state for the rare consumers that need more than copy —
 * `formatShortDate` callers (date order) and the language selector itself
 * (override + setOverride). Same null-ctx fallback as useT.
 */
export function useLocale(): { locale: Locale; override: LocaleOverride; setOverride(next: LocaleOverride): void } {
  const ctx = useContext(LocaleContext);
  return ctx ?? { locale: DEFAULT_LOCALE, override: null, setOverride: () => {} };
}