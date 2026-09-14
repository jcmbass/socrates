import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";
import { NoObjectGeneratedError, type LanguageModel, type LanguageModelUsage } from "ai";

const { generateObjectMock } = vi.hoisted(() => ({ generateObjectMock: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: generateObjectMock };
});

import { createStructuredAdapter } from "../execution/structured";
import { loadModelsConfig } from "../config";
import { InMemoryTelemetrySink } from "../telemetry";

function fakeModel(): LanguageModel {
  return { modelId: "fake" } as unknown as LanguageModel;
}

const judgeSchema = z.object({ hint_offered: z.boolean(), student_correct: z.boolean() });
const validJudgeObject = { hint_offered: true, student_correct: false };

function usageOf(inputTokens: number, outputTokens: number) {
  return {
    inputTokens,
    outputTokens,
    inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

/** Full `LanguageModelUsage` shape (Part A0) — needed to construct a real `NoObjectGeneratedError`, which types `usage` as required, not the loose `usageOf` shape `generateObject`'s success path accepts structurally. */
function fullUsageOf(inputTokens: number, outputTokens: number): LanguageModelUsage {
  return {
    inputTokens,
    outputTokens,
    inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokenDetails: { textTokens: outputTokens, reasoningTokens: 0 },
    totalTokens: inputTokens + outputTokens,
  };
}

/** A REAL `NoObjectGeneratedError` (not a generic `Error`) carrying `usage` — the shape a genuine schema-validation failure has, per structured.ts's cost-accumulation handling. */
function noObjectGeneratedErrorWithUsage(inputTokens: number, outputTokens: number): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: "could not parse JSON matching schema",
    response: { id: "resp-1", timestamp: new Date(), modelId: "claude-sonnet-5" },
    usage: fullUsageOf(inputTokens, outputTokens),
    finishReason: "stop",
  });
}

describe("createStructuredAdapter.generateStructured", () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  it("serves the primary candidate on success and returns O-9 provenance", async () => {
    generateObjectMock.mockResolvedValue({ object: validJudgeObject, usage: usageOf(100, 20) });
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createStructuredAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    const result = await adapter.generateStructured({
      task: "judge",
      system: "system prompt",
      prompt: "user prompt",
      schema: judgeSchema,
      promptVersion: "buxo-judge-v1",
    });

    expect(result).toMatchObject({
      ok: true,
      object: validJudgeObject,
      servedBy: { providerId: "anthropic", modelId: "claude-sonnet-5" },
      promptVersion: "buxo-judge-v1",
      // Part A0 (TODOS.md "deuda F1/WP5"): claude-sonnet-5 is priced
      // ($2/$10 per MTok in registry.ts) — 100 in + 20 out.
      costUsd: expect.closeTo(100 * (2 / 1e6) + 20 * (10 / 1e6), 9),
    });
  });

  it("forces the registry's structuredOutputForce providerOptions (the fase-4 fix, generalized)", async () => {
    generateObjectMock.mockResolvedValue({ object: validJudgeObject, usage: usageOf(100, 20) });
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createStructuredAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    await adapter.generateStructured({
      task: "judge",
      system: "system prompt",
      prompt: "user prompt",
      schema: judgeSchema,
    });

    const call = generateObjectMock.mock.calls[0][0];
    expect(call.providerOptions).toEqual({ anthropic: { structuredOutputMode: "outputFormat" } });
    expect(call.maxOutputTokens).toBeUndefined();
    expect(call.abortSignal).toBeUndefined();
  });

  it("MANDATORY: falls back to the second candidate and records a fallback telemetry event when the first throws a network error", async () => {
    // sameModelRetries is 1 for structured tasks (§1.3.1) — the first
    // candidate must fail TWICE (initial attempt + its one same-model
    // retry) before the engine advances to the second chain candidate.
    generateObjectMock
      .mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"))
      .mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"))
      .mockResolvedValueOnce({ object: validJudgeObject, usage: usageOf(100, 20) });

    const config = loadModelsConfig({
      raw: { judge: "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5" },
      environment: "dev",
    });
    const telemetry = new InMemoryTelemetrySink();
    const adapter = createStructuredAdapter({ config, environment: "dev", telemetry, resolveProvider: fakeModel });

    const result = await adapter.generateStructured({
      task: "judge",
      system: "system prompt",
      prompt: "user prompt",
      schema: judgeSchema,
    });

    expect(result).toMatchObject({ ok: true, servedBy: { providerId: "anthropic", modelId: "claude-sonnet-5" } });
    expect(generateObjectMock).toHaveBeenCalledTimes(3);

    const fallbackEvents = telemetry.events.filter((e) => e.type === "fallback");
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0]).toMatchObject({
      task: "judge",
      from: { providerId: "anthropic", modelId: "claude-haiku-4-5" },
      to: { providerId: "anthropic", modelId: "claude-sonnet-5" },
      reason: "network_error",
    });

    const callEvents = telemetry.events.filter((e) => e.type === "model_call");
    expect(callEvents).toHaveLength(1);
    expect(callEvents[0]).toMatchObject({ servedBy: { providerId: "anthropic", modelId: "claude-sonnet-5" } });
  });

  it("retries the SAME model once on a structured-output validation failure before advancing (§1.3.1)", async () => {
    generateObjectMock
      .mockRejectedValueOnce(new Error("AI_NoObjectGeneratedError: could not parse JSON matching schema"))
      .mockResolvedValueOnce({ object: validJudgeObject, usage: usageOf(50, 10) });

    const config = loadModelsConfig({ raw: {}, environment: "dev" }); // single-entry floor chain
    const telemetry = new InMemoryTelemetrySink();
    const adapter = createStructuredAdapter({ config, environment: "dev", telemetry, resolveProvider: fakeModel });

    const result = await adapter.generateStructured({
      task: "judge",
      system: "s",
      prompt: "p",
      schema: judgeSchema,
    });

    expect(result).toMatchObject({ ok: true, servedBy: { providerId: "anthropic", modelId: "claude-sonnet-5" } });
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    // Same model both times -> no fallback event.
    expect(telemetry.events.filter((e) => e.type === "fallback")).toHaveLength(0);
  });

  it("guided-items uses its DeepInfra floor and the same one-retry structured-output path", async () => {
    const guidedSchema = z.object({ items: z.array(z.object({ prompt: z.string() })) });
    const guidedObject = { items: [{ prompt: "Contenido concreto" }] };
    generateObjectMock
      .mockRejectedValueOnce(new Error("AI_NoObjectGeneratedError: schema mismatch"))
      .mockResolvedValueOnce({ object: guidedObject, usage: usageOf(80, 30) });
    const config = loadModelsConfig({
      raw: { guidedItems: "deepinfra:deepseek-ai/DeepSeek-V4-Flash-0731" },
      environment: "prod",
      guidedItemsAllowPendingGate: true,
    });
    const adapter = createStructuredAdapter({ config, environment: "prod", resolveProvider: fakeModel });

    const result = await adapter.generateStructured({
      task: "guided-items",
      system: "s",
      prompt: "p",
      schema: guidedSchema,
      promptVersion: "guided-items-v2",
      maxOutputTokens: 1800,
      timeoutMs: 75_000,
    });

    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(generateObjectMock.mock.calls[0][0].maxOutputTokens).toBe(1800);
    expect(generateObjectMock.mock.calls[1][0].maxOutputTokens).toBe(1800);
    expect(generateObjectMock.mock.calls[0][0].abortSignal).toBeDefined();
    expect(generateObjectMock.mock.calls[1][0].abortSignal).not.toBe(
      generateObjectMock.mock.calls[0][0].abortSignal,
    );
    expect(result).toMatchObject({
      ok: true,
      object: guidedObject,
      servedBy: { providerId: "deepinfra", modelId: "deepseek-ai/DeepSeek-V4-Flash-0731" },
      promptVersion: "guided-items-v2",
    });
  });

  it("labels an empty guided-items chain as empty_chain instead of a silent unknown degrade", async () => {
    const guidedSchema = z.object({ items: z.array(z.object({ prompt: z.string() })) });
    const config = loadModelsConfig({
      raw: { guidedItems: "deepinfra:deepseek-ai/DeepSeek-V4-Flash-0731" },
      environment: "prod",
      guidedItemsAllowPendingGate: false,
    });
    const adapter = createStructuredAdapter({ config, environment: "prod", resolveProvider: fakeModel });

    const result = await adapter.generateStructured({
      task: "guided-items",
      system: "s",
      prompt: "p",
      schema: guidedSchema,
    });

    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      servedBy: null,
      promptVersion: null,
      costUsd: null,
      error: "empty_chain",
    });
  });

  it("per-attempt timeoutMs aborts a hung call and degrades without fabricating cost", async () => {
    generateObjectMock.mockImplementation(
      ({ abortSignal }: { abortSignal?: { aborted: boolean; addEventListener: (type: string, fn: () => void) => void } }) => {
        return new Promise((_resolve, reject) => {
          const fail = () => {
            const err = new Error("The operation was aborted due to timeout");
            err.name = "TimeoutError";
            reject(err);
          };
          if (abortSignal?.aborted) {
            fail();
            return;
          }
          abortSignal?.addEventListener("abort", fail);
        });
      },
    );
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createStructuredAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    const started = Date.now();
    const result = await adapter.generateStructured({
      task: "judge",
      system: "s",
      prompt: "p",
      schema: judgeSchema,
      timeoutMs: 40,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: false,
      servedBy: null,
      promptVersion: null,
      costUsd: null,
      error: "The operation was aborted due to timeout",
    });
  });

  it("degrades to { ok: false, servedBy: null } (never throws) once the entire chain is exhausted — preserves the existing degrade-to-null contract", async () => {
    generateObjectMock.mockRejectedValue(new Error("could not parse JSON matching schema"));
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createStructuredAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    const result = await adapter.generateStructured({
      task: "judge",
      system: "s",
      prompt: "p",
      schema: judgeSchema,
    });

    // A generic Error (not NoObjectGeneratedError) never carries usage, so
    // nothing to fold into costUsd here — see the dedicated "sums costUsd"
    // test below for the case where failed attempts DO carry usage.
    expect(result).toEqual({
      ok: false,
      servedBy: null,
      promptVersion: null,
      costUsd: null,
      error: "could not parse JSON matching schema",
    });
  });

  it("Part A0: sums costUsd across EVERY attempt of a call, including a same-model retry that failed with usage (TODOS.md 'deuda F1/WP5')", async () => {
    // First attempt fails with a REAL NoObjectGeneratedError carrying usage
    // (the schema-validation-failure shape structured.ts specifically
    // recovers cost from) — the same-model retry then succeeds.
    generateObjectMock
      .mockRejectedValueOnce(noObjectGeneratedErrorWithUsage(50, 10))
      .mockResolvedValueOnce({ object: validJudgeObject, usage: usageOf(100, 20) });

    const config = loadModelsConfig({ raw: {}, environment: "dev" }); // single-entry floor chain (claude-sonnet-5)
    const adapter = createStructuredAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    const result = await adapter.generateStructured({ task: "judge", system: "s", prompt: "p", schema: judgeSchema });

    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    // sonnet pricing ($2/$10 per MTok): failed attempt (50,10) + served attempt (100,20).
    const expectedCost = (50 * (2 / 1e6) + 10 * (10 / 1e6)) + (100 * (2 / 1e6) + 20 * (10 / 1e6));
    expect(result.costUsd).toBeCloseTo(expectedCost, 9);
  });

  it("Part A0: sums costUsd across failed attempts even when the ENTIRE chain is exhausted (ok: false still reports the burned cost)", async () => {
    // Every attempt fails with usage-bearing NoObjectGeneratedError — the
    // chain is a single-entry floor (claude-sonnet-5), sameModelRetries: 1,
    // so exactly 2 attempts happen before degrading to ok:false.
    generateObjectMock.mockRejectedValue(noObjectGeneratedErrorWithUsage(30, 5));
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createStructuredAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    const result = await adapter.generateStructured({ task: "judge", system: "s", prompt: "p", schema: judgeSchema });

    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    const perAttemptCost = 30 * (2 / 1e6) + 5 * (10 / 1e6);
    expect(result.costUsd).toBeCloseTo(perAttemptCost * 2, 9);
  });

  it("Part A0: costUsd is null (not fabricated) when the serving candidate has no known pricing", async () => {
    // mistral-small-latest (registry.ts) has pricePerMTokIn/Out: null — a
    // deliberate "no data" row, never a point estimate inside a range.
    // pending_gate -> needs devAllowPendingGate to enter the dev chain.
    generateObjectMock.mockResolvedValue({ object: validJudgeObject, usage: usageOf(40, 8) });
    const config = loadModelsConfig({
      raw: { judge: "mistral:mistral-small-latest" },
      environment: "dev",
      devAllowPendingGate: true,
    });
    const adapter = createStructuredAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    const result = await adapter.generateStructured({ task: "judge", system: "s", prompt: "p", schema: judgeSchema });

    // Succeeds on the FIRST (unpriced) candidate — never advances to the
    // priced floor, so this genuinely exercises the "no pricing" path.
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, servedBy: { providerId: "mistral", modelId: "mistral-small-latest" } });
    expect(result.costUsd).toBeNull();
  });

  it("skips a candidate whose registry row has structuredOutputSupport 'none' without attempting it", async () => {
    // No row in the real registry has "none" today, so this exercises the
    // `skip` wiring directly against a chain with a capability the adapter
    // must respect once such a row exists — proven via the shared
    // failover engine (already covered end-to-end in failover.test.ts's
    // "skips a candidate" case). This test asserts the ADAPTER wires
    // `skip` to `structuredOutputSupport === "none"` specifically.
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createStructuredAdapter({ config, environment: "dev", resolveProvider: fakeModel });
    // claude-sonnet-5 (the only chain entry here) has native_schema support, so it must NOT be skipped.
    generateObjectMock.mockResolvedValue({ object: validJudgeObject, usage: usageOf(10, 5) });
    const result = await adapter.generateStructured({ task: "judge", system: "s", prompt: "p", schema: judgeSchema });
    expect(result.ok).toBe(true);
  });
});
