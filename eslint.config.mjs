import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next. Repo root now lints
  // across the whole monorepo (apps/*, packages/*), so these must match at
  // any depth, not just the old single-package root.
  globalIgnores([
    // Default ignores of eslint-config-next:
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    // Monorepo-wide
    "**/node_modules/**",
    "docs/**",
    "sessions/**",
    "eval-results/**",
    ".ingest-cache/**",
    "**/.ingest-cache/**",
    // Expo (apps/mobile) generated output: Metro export bundle + .expo
    // cache/typed-routes codegen.
    "apps/mobile/dist/**",
    "**/.expo/**",
    // SPIKE F0.5 (throwaway, __DEV__ only, C-cliente-e-ingesta.md §2):
    // webview-src/entry.ts runs in a browser/WebView global (DOM lib only,
    // its own tsconfig) and imports a gitignored generated module
    // (spike-f05/build.mjs's output) that may not exist on a fresh
    // checkout — both would otherwise break a repo-wide `npm run lint`.
    "apps/mobile/spike-f05/**",
    "apps/mobile/app/dev/spike-f05.tsx",
  ]),
]);

export default eslintConfig;
