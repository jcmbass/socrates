import { defineConfig } from "vitest/config";

/**
 * Minimal node-environment config for packages/core's own test suite.
 * No jsdom, no React plugin: this package has no DOM/React dependency by
 * construction (see tsconfig.json's "lib": ["ES2023"] with no "dom" — the
 * mechanical proof this package doesn't depend on the browser).
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
});
