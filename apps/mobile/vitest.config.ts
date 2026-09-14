/**
 * Vitest (node environment) for the app's PURE logic only (lib/): mock
 * tutor streaming, LocalStore, catalog/builder helpers, the zustand store
 * factory. Nothing under test imports react-native — RN-dependent code
 * (screens, components, the AsyncStorage-backed LocalStore binding) is
 * exercised by the `expo export` bundling gate instead.
 *
 * Why vitest and not jest-expo: the monorepo already runs vitest 4 from
 * the root for every other workspace (`npm test` → `--workspaces`); the
 * mandate's tests are pure TS with no RN runtime surface, so jest-expo
 * would add a second test framework + babel config for zero extra
 * coverage. The DF-5.1 "core under the RN runtime" check is NOT covered
 * here (vitest runs under node, not Hermes) — flagged as debt in the WP2
 * report.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // theme/tokens.ts is also pure TS (no react-native import) — its
    // palette-pinning test lives in theme/__tests__ alongside the module
    // it tests, same rule as lib/__tests__.
    // plugins/__tests__ son los config plugins de Expo: JS puro de Node que
    // corre durante `expo prebuild`, sin superficie de RN. Su propiedad
    // crítica (idempotencia al reaplicarse) se fija acá porque "corrí
    // prebuild dos veces" la prueba una sola vez, en una sola máquina.
    include: [
      "lib/__tests__/**/*.test.ts",
      "lib/__tests__/**/*.test.tsx",
      "theme/__tests__/**/*.test.ts",
      "plugins/__tests__/**/*.test.ts",
      // A1 — i18n es TS puro (sin react-native): catálogo, resolveLocale,
      // prefs en memoria. El provider (i18n/react.tsx) NO corre acá (react).
      "i18n/__tests__/**/*.test.ts",
    ],
    environment: "node",
  },
});
