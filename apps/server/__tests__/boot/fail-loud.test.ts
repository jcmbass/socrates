/**
 * Boot fail-loud invariant (C-backend §1.2, C7's central rule) — exercised
 * exactly the way `src/index.ts` exercises it (env -> `modelsRawConfigFromEnv`
 * -> `loadModelsConfig`), without importing `index.ts` itself (which has
 * top-level side effects: binds a port, opens a real `pg.Pool`). A
 * malformed/unregistered chain entry must THROW at config-load time, never
 * degrade silently and never defer the failure to the first request.
 */
import { describe, expect, it } from "vitest";
import { loadModelsConfig } from "@buxo/models/config";
import { createApp } from "../../src/app";
import { parseEnvFlag, readEnv } from "../../src/env";
import { assertGuidedItemsChainReady, modelsRawConfigFromEnv } from "../../src/models/config-from-env";
import { buildTestDeps } from "../support/test-deps";

function bootModelsConfig(envOverrides: Record<string, string>) {
  const env = readEnv({ ...process.env, ...envOverrides });
  return loadModelsConfig({
    raw: modelsRawConfigFromEnv(env),
    environment: env.BUXO_ENV,
    devAllowPendingGate: env.BUXO_DEV_ALLOW_PENDING_GATE,
    guidedItemsAllowPendingGate: env.BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE,
  });
}

describe("boot fail-loud: unregistered (providerId, modelId) pairs throw at config load", () => {
  it("parses the guided sources fail-close feature flag at boot", () => {
    expect(readEnv({ BUXO_GUIDED_REQUIRE_SOURCES: "1" }).BUXO_GUIDED_REQUIRE_SOURCES).toBe(true);
    expect(readEnv({}).BUXO_GUIDED_REQUIRE_SOURCES).toBe(false);
    expect(readEnv({ BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE: "1" }).BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE).toBe(true);
    expect(readEnv({}).BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE).toBe(false);
    expect(parseEnvFlag("True")).toBe(true);
    expect(parseEnvFlag(" YES ")).toBe(true);
    expect(parseEnvFlag('"1"')).toBe(true);
    expect(parseEnvFlag("'true'")).toBe(true);
    expect(readEnv({ BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE: "True" }).BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE).toBe(true);
    expect(readEnv({ BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE: " yes " }).BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE).toBe(true);
  });

  it("fails loud in prod when guided-items generation is expected but the chain is empty", () => {
    const env = readEnv({
      BUXO_ENV: "prod",
      JWT_SECRET: "a-long-random-value-not-the-default-32",
      BUXO_FAKE_MODELS: "false",
      BUXO_GUIDED_ITEMS_CHAIN: "deepinfra:deepseek-ai/DeepSeek-V4-Flash-0731",
      BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE: "0",
      BUXO_GUIDED_REQUIRE_SOURCES: "0",
    });
    const blocked = loadModelsConfig({
      raw: modelsRawConfigFromEnv(env),
      environment: env.BUXO_ENV,
      guidedItemsAllowPendingGate: env.BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE,
    });
    expect(blocked.chains["guided-items"]).toEqual([]);
    expect(() => assertGuidedItemsChainReady(env, blocked)).toThrow(/guided-items chain is empty/);

    const allowedEnv = readEnv({
      BUXO_ENV: "prod",
      JWT_SECRET: "a-long-random-value-not-the-default-32",
      BUXO_FAKE_MODELS: "false",
      BUXO_GUIDED_ITEMS_CHAIN: "deepinfra:deepseek-ai/DeepSeek-V4-Flash-0731",
      BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE: "1",
      BUXO_GUIDED_REQUIRE_SOURCES: "0",
    });
    const allowed = loadModelsConfig({
      raw: modelsRawConfigFromEnv(allowedEnv),
      environment: allowedEnv.BUXO_ENV,
      guidedItemsAllowPendingGate: allowedEnv.BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE,
    });
    expect(() => assertGuidedItemsChainReady(allowedEnv, allowed)).not.toThrow();
  });

  it("healthz reports whether the guided-items flags would serve a chain", async () => {
    const ctx = await buildTestDeps();
    try {
      const app = createApp(ctx.deps);
      const body = await (await app.request("/healthz")).json();
      expect(body).toEqual({
        ok: true,
        guidedItems: {
          ready: true,
          allowPendingGate: true,
          requireSources: false,
          chainConfigured: true,
        },
      });
    } finally {
      await ctx.testDb.close();
    }
  });

  it("throws for a completely made-up model id", () => {
    expect(() => bootModelsConfig({ BUXO_TUTOR_CHAIN: "anthropic:not-a-real-model" })).toThrow(/no row in the @buxo\/models capabilities registry/);
  });

  it("throws for a well-formed but unregistered provider", () => {
    expect(() => bootModelsConfig({ BUXO_ASSESSOR_CHAIN: "totally-unknown-provider:some-model" })).toThrow();
  });

  it("does NOT throw for a registered, gated pair (anthropic:claude-sonnet-5)", () => {
    expect(() => bootModelsConfig({ BUXO_TUTOR_CHAIN: "anthropic:claude-sonnet-5" })).not.toThrow();
  });

  it("wires BUXO_GUIDED_ITEMS_CHAIN only when the pending-gate allow flag is on", () => {
    expect(() => bootModelsConfig({ BUXO_GUIDED_ITEMS_CHAIN: "deepinfra:not-real" })).toThrow(/guided-items/);
    const blocked = bootModelsConfig({
      BUXO_ENV: "prod",
      JWT_SECRET: "a-long-random-value-not-the-default-32",
      BUXO_FAKE_MODELS: "false",
      BUXO_GUIDED_ITEMS_CHAIN: "deepinfra:deepseek-ai/DeepSeek-V4-Flash-0731",
      BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE: "0",
    });
    expect(blocked.chains["guided-items"]).toEqual([]);
    const config = bootModelsConfig({
      BUXO_ENV: "prod",
      JWT_SECRET: "a-long-random-value-not-the-default-32",
      BUXO_FAKE_MODELS: "false",
      BUXO_GUIDED_ITEMS_CHAIN: "deepinfra:deepseek-ai/DeepSeek-V4-Flash-0731",
      BUXO_GUIDED_ITEMS_ALLOW_PENDING_GATE: "1",
    });
    expect(config.chains["guided-items"]).toEqual([
      { providerId: "deepinfra", modelId: "deepseek-ai/DeepSeek-V4-Flash-0731" },
    ]);
  });

  it("does NOT throw and falls back to the hardcoded floor on an empty/malformed chain string (§1.3)", () => {
    expect(() => bootModelsConfig({ BUXO_JUDGE_CHAIN: "" })).not.toThrow();
    const config = bootModelsConfig({ BUXO_JUDGE_CHAIN: "not-even-a-colon" });
    expect(config.chains.judge).toEqual([{ providerId: "anthropic", modelId: "claude-sonnet-5" }]);
  });

  it("does NOT throw for an empty/malformed P2 temario-builder chain, but resolves to an EMPTY chain (P2 FIX1: no Sonnet floor — a stateful builder is never failover-safe)", () => {
    expect(() => bootModelsConfig({ BUXO_TEMARIO_BUILDER_CHAIN: "" })).not.toThrow();
    const config = bootModelsConfig({ BUXO_TEMARIO_BUILDER_CHAIN: "" });
    expect(config.chains["temario-builder"]).toEqual([]);
  });

  it("P2 FIX1: throws for a multi-model temario-builder chain (cross-model failover mid-construction is unsupported)", () => {
    expect(() =>
      bootModelsConfig({ BUXO_TEMARIO_BUILDER_CHAIN: "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5" }),
    ).toThrow(/temario-builder.*multi-model chain/i);
  });

  it("rejects devAllowPendingGate=true outside dev (must never leak into staging/prod)", () => {
    expect(() =>
      loadModelsConfig({ raw: {}, environment: "prod", devAllowPendingGate: true }),
    ).toThrow(/devAllowPendingGate=true is only valid in the "dev" environment/);
  });
});

describe("boot fail-loud: Ollama pending_gate chain", () => {
  it("resolves ollama:gemma4:31b-cloud in dev WITH devAllowPendingGate=true", () => {
    const config = bootModelsConfig({
      BUXO_TUTOR_CHAIN: "ollama:gemma4:31b-cloud",
      BUXO_DEV_ALLOW_PENDING_GATE: "true",
      BUXO_ENV: "dev",
    });
    const chain = config.chains.tutor;
    expect(chain.some((ref) => ref.providerId === "ollama" && ref.modelId === "gemma4:31b-cloud")).toBe(true);
  });

  it("keeps ollama:gemma4:31b-cloud in dev WITHOUT devAllowPendingGate (now validated — BE2 gate O-14 PASS)", () => {
    const config = bootModelsConfig({
      BUXO_TUTOR_CHAIN: "ollama:gemma4:31b-cloud",
      BUXO_DEV_ALLOW_PENDING_GATE: "false",
      BUXO_ENV: "dev",
    });
    const chain = config.chains.tutor;
    // gemma is now validated (BE2 gate O-14 PASS), so it stays in the chain
    expect(chain.some((ref) => ref.providerId === "ollama" && ref.modelId === "gemma4:31b-cloud")).toBe(true);
    // The floor (Sonnet) must still be present (default failover)
    expect(chain.some((ref) => ref.providerId === "anthropic" && ref.modelId === "claude-sonnet-5")).toBe(true);
  });
});
