import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LanguageModel } from "ai";

const { streamTextMock } = vi.hoisted(() => ({ streamTextMock: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: streamTextMock };
});

import { createTutorAdapter } from "../execution/tutor";
import { loadModelsConfig } from "../config";
import { InMemoryTelemetrySink } from "../telemetry";
import { PROMPT_VERSION } from "@buxo/core/prompts";

function fakeModel(): LanguageModel {
  return { modelId: "fake" } as unknown as LanguageModel;
}

function makeStreamTextResult(usage?: Record<string, unknown>) {
  return {
    usage: Promise.resolve(
      usage ?? {
        inputTokens: 1000,
        outputTokens: 200,
        inputTokenDetails: { noCacheTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ),
    toTextStreamResponse: () => new Response("mock stream"),
  };
}

// Small tick to let the fire-and-forget telemetry .then() run before assertions.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createTutorAdapter.streamReply", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
  });

  it("serves the primary tutor candidate on success and returns O-9 provenance", async () => {
    streamTextMock.mockReturnValue(makeStreamTextResult());
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createTutorAdapter({
      config,
      environment: "dev",
      resolveProvider: fakeModel,
    });

    const reply = await adapter.streamReply({
      messages: [{ role: "user", content: "hola, ¿qué es una derivada?" }],
      band: "guiding",
    });

    expect(reply.servedBy).toEqual({ providerId: "anthropic", modelId: "claude-sonnet-5" });
    expect(reply.promptVersion).toBe(PROMPT_VERSION);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });

  it("applies the Anthropic cache breakpoint when the serving candidate's registry row supports explicit_breakpoints", async () => {
    streamTextMock.mockReturnValue(makeStreamTextResult());
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createTutorAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    await adapter.streamReply({
      messages: [{ role: "user", content: "hola" }],
      band: "guiding",
    });

    const call = streamTextMock.mock.calls[0][0];
    expect(call.system).toMatchObject({
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    });
  });

  it("MANDATORY: falls back to the second candidate and records a fallback telemetry event when the first throws", async () => {
    streamTextMock
      .mockImplementationOnce(() => {
        throw new Error("503 service unavailable");
      })
      .mockReturnValueOnce(makeStreamTextResult());

    const config = loadModelsConfig({
      raw: { tutor: "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5" },
      environment: "dev",
    });
    const telemetry = new InMemoryTelemetrySink();
    const adapter = createTutorAdapter({ config, environment: "dev", telemetry, resolveProvider: fakeModel });

    const reply = await adapter.streamReply({
      messages: [{ role: "user", content: "hola" }],
      band: "guiding",
    });

    expect(reply.servedBy).toEqual({ providerId: "anthropic", modelId: "claude-sonnet-5" });
    expect(streamTextMock).toHaveBeenCalledTimes(2);

    const fallbackEvents = telemetry.events.filter((e) => e.type === "fallback");
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0]).toMatchObject({
      task: "tutor",
      from: { providerId: "anthropic", modelId: "claude-haiku-4-5" },
      to: { providerId: "anthropic", modelId: "claude-sonnet-5" },
      reason: "http_5xx",
    });
  });

  it("records a model_call telemetry event with cost/tokens once usage resolves", async () => {
    streamTextMock.mockReturnValue(makeStreamTextResult({ inputTokens: 2000, outputTokens: 1000, inputTokenDetails: { noCacheTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 } }));
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const telemetry = new InMemoryTelemetrySink();
    const adapter = createTutorAdapter({ config, environment: "dev", telemetry, resolveProvider: fakeModel });

    await adapter.streamReply({ messages: [{ role: "user", content: "hola" }], band: "guiding" });
    await flush();

    const callEvents = telemetry.events.filter((e) => e.type === "model_call");
    expect(callEvents).toHaveLength(1);
    expect(callEvents[0]).toMatchObject({
      task: "tutor",
      servedBy: { providerId: "anthropic", modelId: "claude-sonnet-5" },
      inputTokens: 2000,
      outputTokens: 1000,
      // (2000 * 2 + 1000 * 10) / 1e6 = 0.014
      costUsd: 0.014,
      promptVersion: PROMPT_VERSION,
    });
  });

  it("throws ModelChainExhaustedError when the entire chain fails", async () => {
    streamTextMock.mockImplementation(() => {
      throw new Error("network unreachable");
    });
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createTutorAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    await expect(
      adapter.streamReply({ messages: [{ role: "user", content: "hola" }], band: "guiding" }),
    ).rejects.toThrow(/tutor.*chain failed/i);
  });

  it("uses buxo-socratic-v3 prompt version by default (no promptVersion given)", async () => {
    streamTextMock.mockReturnValue(makeStreamTextResult());
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createTutorAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    const reply = await adapter.streamReply({
      messages: [{ role: "user", content: "hola" }],
      band: "guiding",
    });

    expect(reply.promptVersion).toBe("buxo-socratic-v3");
  });

  it("uses buxo-socratic-v4 when promptVersion is set to v4", async () => {
    streamTextMock.mockReturnValue(makeStreamTextResult());
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createTutorAdapter({
      config,
      environment: "dev",
      resolveProvider: fakeModel,
      promptVersion: "buxo-socratic-v4",
    });

    const reply = await adapter.streamReply({
      messages: [{ role: "user", content: "hola" }],
      band: "guiding",
    });

    expect(reply.promptVersion).toBe("buxo-socratic-v4");
  });

  it("passes hardened:true to getSystemPrompt when promptVersion is v4", async () => {
    streamTextMock.mockReturnValue(makeStreamTextResult());
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createTutorAdapter({
      config,
      environment: "dev",
      resolveProvider: fakeModel,
      promptVersion: "buxo-socratic-v4",
    });

    await adapter.streamReply({
      messages: [{ role: "user", content: "hola" }],
      band: "guiding",
    });

    const call = streamTextMock.mock.calls[0][0];
    // The system prompt with v4 should contain the hardened rules.
    // When cache is used (Sonnet), system is an object with .content.
    const systemContent = typeof call.system === "string" ? call.system : call.system.content;
    expect(systemContent).toContain("HARDENED PRESSURE PROTOCOL");
  });

  it("does NOT pass hardened rules when promptVersion is v3", async () => {
    streamTextMock.mockReturnValue(makeStreamTextResult());
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createTutorAdapter({
      config,
      environment: "dev",
      resolveProvider: fakeModel,
      promptVersion: "buxo-socratic-v3",
    });

    await adapter.streamReply({
      messages: [{ role: "user", content: "hola" }],
      band: "guiding",
    });

    const call = streamTextMock.mock.calls[0][0];
    // The system prompt with v3 should NOT contain the hardened rules.
    const systemContent = typeof call.system === "string" ? call.system : call.system.content;
    expect(systemContent).not.toContain("HARDENED PRESSURE PROTOCOL");
  });
});
