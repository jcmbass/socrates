/**
 * Tests for createProductionProviderResolver — the ONLY place in apps/server
 * that constructs real AI SDK providers. These tests verify:
 *   1. The ollama branch returns a LanguageModel (not undefined/throws).
 *   2. An unknown providerId still throws fail-loud (C7 philosophy).
 *   3. ANTHROPIC_BASE_URL normalization (PB2).
 *
 * This file does NOT import src/index.ts (top-level side effects: binds a
 * port, opens a real pg.Pool).
 */
import { describe, expect, it } from "vitest";
import { createProductionProviderResolver, normalizeAnthropicBaseUrl } from "../../src/models/provider";

describe("normalizeAnthropicBaseUrl — PB2", () => {
  it("undefined -> undefined (SDK usa su default)", () => {
    expect(normalizeAnthropicBaseUrl(undefined)).toBeUndefined();
  });

  it("https://api.anthropic.com -> https://api.anthropic.com/v1 (sin /v1)", () => {
    expect(normalizeAnthropicBaseUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1");
  });

  it("https://api.anthropic.com/v1 -> igual (ya tiene /v1)", () => {
    expect(normalizeAnthropicBaseUrl("https://api.anthropic.com/v1")).toBe("https://api.anthropic.com/v1");
  });

  it("https://api.anthropic.com/ -> https://api.anthropic.com/v1 (trailing slash)", () => {
    expect(normalizeAnthropicBaseUrl("https://api.anthropic.com/")).toBe("https://api.anthropic.com/v1");
  });

  it("https://api.anthropic.com/v1/ -> https://api.anthropic.com/v1 (trailing slash con /v1)", () => {
    expect(normalizeAnthropicBaseUrl("https://api.anthropic.com/v1/")).toBe("https://api.anthropic.com/v1");
  });

  it("http://localhost:8080 -> http://localhost:8080/v1 (custom host)", () => {
    expect(normalizeAnthropicBaseUrl("http://localhost:8080")).toBe("http://localhost:8080/v1");
  });
});

describe("createProductionProviderResolver — Ollama branch", () => {
  it("returns a LanguageModel for ollama:gemma4:31b-cloud (sin apiKey)", () => {
    const resolver = createProductionProviderResolver("fake-key", "http://localhost:11434/v1", undefined);
    const provider = resolver({ providerId: "ollama", modelId: "gemma4:31b-cloud" });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("object");
    // The returned object should have a modelId property (LanguageModel shape)
    expect(provider).toHaveProperty("modelId");
  });

  it("returns a LanguageModel for ollama:gemma4:31b-cloud (con apiKey)", () => {
    const resolver = createProductionProviderResolver("fake-key", "http://localhost:11434/v1", "ollama-cloud-key");
    const provider = resolver({ providerId: "ollama", modelId: "gemma4:31b-cloud" });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("object");
    expect(provider).toHaveProperty("modelId");
  });

  it("still returns a LanguageModel for anthropic:claude-sonnet-5 (backward compat)", () => {
    const resolver = createProductionProviderResolver("fake-key", "http://localhost:11434/v1", undefined);
    const provider = resolver({ providerId: "anthropic", modelId: "claude-sonnet-5" });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("object");
  });

  it("THROWS fail-loud for an unknown providerId (C7 philosophy)", () => {
    const resolver = createProductionProviderResolver("fake-key", "http://localhost:11434/v1", undefined);
    expect(() =>
      resolver({ providerId: "unknown-provider", modelId: "some-model" }),
    ).toThrow(/No provider construction wired for providerId "unknown-provider"/);
  });
});

describe("createProductionProviderResolver — DeepInfra branch (pending_gate candidate, 2026-08-01)", () => {
  it("returns a LanguageModel for deepinfra:Qwen/Qwen3-VL-30B-A3B-Instruct (con apiKey)", () => {
    const resolver = createProductionProviderResolver(
      "fake-key",
      "http://localhost:11434/v1",
      undefined,
      undefined,
      undefined,
      "deepinfra-key",
    );
    const provider = resolver({ providerId: "deepinfra", modelId: "Qwen/Qwen3-VL-30B-A3B-Instruct" });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("object");
    expect(provider).toHaveProperty("modelId");
  });

  it("returns a LanguageModel for deepinfra:Qwen/Qwen3-VL-30B-A3B-Instruct (sin apiKey, sin baseURL override — usa el default)", () => {
    const resolver = createProductionProviderResolver("fake-key", "http://localhost:11434/v1", undefined);
    const provider = resolver({ providerId: "deepinfra", modelId: "Qwen/Qwen3-VL-30B-A3B-Instruct" });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("object");
    expect(provider).toHaveProperty("modelId");
  });

  it("respects a custom deepinfraBaseUrl override", () => {
    const resolver = createProductionProviderResolver(
      "fake-key",
      "http://localhost:11434/v1",
      undefined,
      undefined,
      "https://custom.deepinfra.example/v1/openai",
    );
    const provider = resolver({ providerId: "deepinfra", modelId: "Qwen/Qwen3-VL-30B-A3B-Instruct" });
    expect(provider).toBeDefined();
  });

  it("the modelId with '/' round-trips intact through the resolver (matches the exact registry modelId)", () => {
    const resolver = createProductionProviderResolver("fake-key", "http://localhost:11434/v1", undefined);
    const provider = resolver({ providerId: "deepinfra", modelId: "Qwen/Qwen3-VL-30B-A3B-Instruct" }) as {
      modelId?: string;
    };
    expect(provider.modelId).toBe("Qwen/Qwen3-VL-30B-A3B-Instruct");
  });
});
