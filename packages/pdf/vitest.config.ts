import { defineConfig } from "vitest/config";

/**
 * Minimal node-environment config for packages/pdf's own test suite.
 * No jsdom, no React plugin: this package is DOM-free by construction
 * (classify.ts/pageText.ts/assemble.ts/types.ts are pure functions over
 * NormalizedPage — see package.json's description) — same pattern as
 * packages/core/vitest.config.ts.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
});
