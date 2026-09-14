import { defineConfig } from "vitest/config";

/**
 * Minimal node-environment config for packages/models's own test suite.
 * No jsdom, no React plugin, no network: this package has no DOM/React
 * dependency by construction (see tsconfig.json's "lib": ["ES2023"] with no
 * "dom" — same gate as packages/core and packages/domain) and every test
 * exercises this package against injected doubles (ProviderResolver mocks,
 * MockLanguageModel/vi.mock("ai", ...)) — never a real API call.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
});
