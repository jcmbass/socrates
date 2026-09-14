/**
 * BUXO_FAKE_MODELS boot wiring (F1/WP6 Part 1). Two things under test,
 * matching src/env.ts + src/models/select.ts exactly:
 *   1. `readEnv` throws (fail-loud, at parse time) for BUXO_FAKE_MODELS=1
 *      outside BUXO_ENV=dev — mirrors __tests__/boot/fail-loud.test.ts's
 *      pattern for devAllowPendingGate.
 *   2. `buildModelAdapters` picks the fake adapters when the flag is on,
 *      and the real ones when it's off — without importing src/index.ts
 *      (top-level side effects: binds a port, opens a real pg.Pool).
 */
import { describe, expect, it } from "vitest";
import { loadModelsConfig } from "@buxo/models/config";
import { readEnv, type ServerEnv } from "../../src/env";
import { buildModelAdapters } from "../../src/models/select";
import { fakeProviderResolver } from "../../src/models/fakes";

const BASE_ENV_OVERRIDES = {
  JWT_SECRET: "test-only-secret-at-least-32-characters-long",
};

describe("BUXO_FAKE_MODELS — readEnv fail-loud guard", () => {
  it("throws when BUXO_FAKE_MODELS=1 and BUXO_ENV is not dev", () => {
    expect(() =>
      readEnv({ ...process.env, ...BASE_ENV_OVERRIDES, BUXO_FAKE_MODELS: "1", BUXO_ENV: "prod" }),
    ).toThrow(/BUXO_FAKE_MODELS=1 solo es válido cuando BUXO_ENV=dev/);

    expect(() =>
      readEnv({ ...process.env, ...BASE_ENV_OVERRIDES, BUXO_FAKE_MODELS: "true", BUXO_ENV: "staging" }),
    ).toThrow(/BUXO_FAKE_MODELS=1 solo es válido cuando BUXO_ENV=dev/);
  });

  it("does NOT throw when BUXO_FAKE_MODELS=1 and BUXO_ENV=dev", () => {
    const env = readEnv({ ...process.env, ...BASE_ENV_OVERRIDES, BUXO_FAKE_MODELS: "1", BUXO_ENV: "dev" });
    expect(env.BUXO_FAKE_MODELS).toBe(true);
  });

  it("does NOT throw when BUXO_FAKE_MODELS is unset, regardless of BUXO_ENV", () => {
    const env = readEnv({ ...process.env, ...BASE_ENV_OVERRIDES, BUXO_ENV: "prod" });
    expect(env.BUXO_FAKE_MODELS).toBe(false);
  });

  it('accepts "0"/"false"/garbage as off, not just absence', () => {
    for (const value of ["0", "false", "nope", ""]) {
      const env = readEnv({ ...process.env, ...BASE_ENV_OVERRIDES, BUXO_FAKE_MODELS: value, BUXO_ENV: "prod" });
      expect(env.BUXO_FAKE_MODELS).toBe(false);
    }
  });
});

describe("BUXO_FAKE_MODELS — buildModelAdapters wiring", () => {
  function envFor(fakeModels: boolean): ServerEnv {
    return readEnv({ ...process.env, ...BASE_ENV_OVERRIDES, BUXO_ENV: "dev", BUXO_FAKE_MODELS: fakeModels ? "1" : "0" });
  }

  it("flag ON -> uses the fake ProviderResolver (models/fake-adapters.ts, zero network)", () => {
    const config = loadModelsConfig({ raw: {}, environment: "dev", devAllowPendingGate: false });
    const models = buildModelAdapters(envFor(true), config);
    expect(models.raw.resolveProvider).toBe(fakeProviderResolver);
  });

  it("flag OFF -> uses the real ProviderResolver (models/provider.ts, distinct from the fake one)", () => {
    const config = loadModelsConfig({ raw: {}, environment: "dev", devAllowPendingGate: false });
    const models = buildModelAdapters(envFor(false), config);
    expect(models.raw.resolveProvider).not.toBe(fakeProviderResolver);
    expect(typeof models.raw.resolveProvider).toBe("function");
  });
});
