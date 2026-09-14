import { defineConfig } from "vitest/config";

/**
 * Node-environment config for apps/server's own test suite. No jsdom, no
 * React. Every test that touches Postgres runs against pglite (in-memory,
 * WASM — no external services, no Docker required); every test that
 * touches a model provider injects a fake `ProviderResolver`/mocked `ai`
 * module (same pattern as packages/models/__tests__) — zero real network
 * calls anywhere in this suite.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
