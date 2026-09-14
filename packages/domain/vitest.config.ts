import { defineConfig } from "vitest/config";

/**
 * Minimal node-environment config for packages/domain's own test suite.
 * No jsdom, no React plugin: this package has no DOM/React dependency by
 * construction (see tsconfig.json's "lib": ["ES2023"] with no "dom" — the
 * mechanical proof this package doesn't depend on the browser, same gate
 * as packages/core/vitest.config.ts).
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
});
