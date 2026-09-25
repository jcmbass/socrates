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
 * selector change, (b) post-login y (c) una vez por arranque con sesión.
 *
 * (b) y (c) son EL MISMO efecto (el de `auth?.token` más abajo), no dos: el
 * provider está montado en la raíz (`app/_layout.tsx`), por fuera del gate de
 * hidratación, así que ve aparecer el token tanto cuando `completeLogin()`
 * lo escribe tras `POST /v1/auth/verify` como cuando `hydrate()` lo restaura
 * de AsyncStorage al arrancar. `app/login.tsx` NO sincroniza nada (el
 * comentario que decía que sí quedó viejo; verificado con grep el 2026-09-18
 * y con el provider montado en jsdom).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { apiClient } from "../lib/api/expoClient";
import {
  shouldSyncPreferredLanguage,
  syncPreferredLanguage,
  type PreferredLanguageSyncMark,
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
  // Last (token, locale) successfully handed to the server this session —
  // dedupes the app-start sync (moment c) and keeps selector churn cheap.
  // El token entra en la llave porque un logout+login de otra cuenta sin
  // cerrar la app cambia la FILA que el PATCH escribe (ver
  // shouldSyncPreferredLanguage).
  const lastSyncedRef = useRef<PreferredLanguageSyncMark | null>(null);

  const syncToServer = useCallback(
    (next: Locale, token: string | null | undefined) => {
      if (!token) return;
      const mark: PreferredLanguageSyncMark = { token, locale: next };
      if (!shouldSyncPreferredLanguage(lastSyncedRef.current, mark)) return;
      void syncPreferredLanguage(apiClient, token, next).then((ok) => {
        if (ok) lastSyncedRef.current = mark;
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
    // Runs ONCE per mount. Ojo: `auth` acá es el del PRIMER render (deps []),
    // y en un arranque real el store todavía no hidrató, así que este
    // `syncToServer` casi siempre sale por el `if (!token) return`. Quien
    // sincroniza de verdad es el efecto de abajo; éste solo cubre el caso
    // borde de un remontaje con sesión ya en memoria.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Momentos (b) y (c): el token aparece DESPUÉS de resolver la locale — o
  // porque el login terminó con la app abierta, o porque `hydrate()` restauró
  // la sesión guardada al arrancar. En los dos casos se sincroniza una vez
  // por (token, locale).
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