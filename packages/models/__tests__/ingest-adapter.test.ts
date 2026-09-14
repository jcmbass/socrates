import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LanguageModel } from "ai";

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: generateTextMock };
});

import { createIngestAdapter } from "../execution/ingest";
import { loadModelsConfig } from "../config";
import { InMemoryTelemetrySink } from "../telemetry";
import { ModelChainExhaustedError } from "../errors";

function fakeModel(): LanguageModel {
  return { modelId: "fake" } as unknown as LanguageModel;
}

function usageOf(inputTokens: number, outputTokens: number) {
  return {
    inputTokens,
    outputTokens,
    inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

const imageBytes = new Uint8Array([1, 2, 3, 4]);

describe("createIngestAdapter.transcribeImage", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it("serves the primary (floor) candidate on success and returns O-9 provenance", async () => {
    generateTextMock.mockResolvedValue({ text: "# Transcribed page", usage: usageOf(500, 200) });
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createIngestAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    const result = await adapter.transcribeImage({
      imageBytes,
      mediaType: "image/png",
      prompt: "transcribe this page",
      promptVersion: "buxo-ingest-v1",
    });

    expect(result).toEqual({
      text: "# Transcribed page",
      servedBy: { providerId: "anthropic", modelId: "claude-haiku-4-5" },
      promptVersion: "buxo-ingest-v1",
    });
  });

  it("sends the image + text content parts to generateText", async () => {
    generateTextMock.mockResolvedValue({ text: "ok", usage: usageOf(10, 5) });
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createIngestAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    await adapter.transcribeImage({ imageBytes, mediaType: "image/jpeg", prompt: "p", promptVersion: "v1" });

    const call = generateTextMock.mock.calls[0][0];
    expect(call.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", image: imageBytes, mediaType: "image/jpeg" },
          { type: "text", text: "p" },
        ],
      },
    ]);
  });

  it("MANDATORY: falls back to the next candidate and records a fallback telemetry event on failure", async () => {
    generateTextMock
      .mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"))
      .mockResolvedValueOnce({ text: "recovered", usage: usageOf(100, 20) });

    const config = loadModelsConfig({
      raw: { ingest: "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5" },
      environment: "dev",
    });
    const telemetry = new InMemoryTelemetrySink();
    const adapter = createIngestAdapter({ config, environment: "dev", telemetry, resolveProvider: fakeModel });

    const result = await adapter.transcribeImage({ imageBytes, mediaType: "image/png", prompt: "p", promptVersion: "v1" });

    expect(result).toMatchObject({ text: "recovered", servedBy: { providerId: "anthropic", modelId: "claude-sonnet-5" } });
    expect(generateTextMock).toHaveBeenCalledTimes(2);

    const fallbackEvents = telemetry.events.filter((e) => e.type === "fallback");
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0]).toMatchObject({
      task: "ingest",
      from: { providerId: "anthropic", modelId: "claude-haiku-4-5" },
      to: { providerId: "anthropic", modelId: "claude-sonnet-5" },
      reason: "network_error",
    });

    const callEvents = telemetry.events.filter((e) => e.type === "model_call");
    expect(callEvents).toHaveLength(1);
    expect(callEvents[0]).toMatchObject({ servedBy: { providerId: "anthropic", modelId: "claude-sonnet-5" }, task: "ingest" });
  });

  it("throws ModelChainExhaustedError once the entire chain is exhausted (never degrades silently)", async () => {
    generateTextMock.mockRejectedValue(new Error("fetch failed: ECONNRESET"));
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createIngestAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    await expect(
      adapter.transcribeImage({ imageBytes, mediaType: "image/png", prompt: "p", promptVersion: "v1" }),
    ).rejects.toThrow(ModelChainExhaustedError);
  });

  it("treats an empty transcription as a failure that triggers fallback, not a valid (empty) result", async () => {
    generateTextMock
      .mockResolvedValueOnce({ text: "   ", usage: usageOf(10, 0) })
      .mockResolvedValueOnce({ text: "real content", usage: usageOf(10, 5) });

    const config = loadModelsConfig({
      raw: { ingest: "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5" },
      environment: "dev",
    });
    const adapter = createIngestAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    const result = await adapter.transcribeImage({ imageBytes, mediaType: "image/png", prompt: "p", promptVersion: "v1" });
    expect(result.text).toBe("real content");
  });

  it("skips a candidate whose registry row has vision: false without attempting it", async () => {
    // openrouter:deepseek-v3.2 has vision:false in the registry; it must be
    // skipped (never attempted) and the floor (claude-haiku-4-5, vision:true) serves instead.
    generateTextMock.mockResolvedValue({ text: "served by floor", usage: usageOf(10, 5) });
    // devAllowPendingGate:true so deepseek-v3.2 (pending_gate) actually enters
    // the resolved chain — otherwise gate.ts's isServableForTask would drop
    // it before this adapter ever saw it, and the skip() wiring wouldn't be exercised.
    const config = loadModelsConfig({ raw: { ingest: "openrouter:deepseek-v3.2" }, environment: "dev", devAllowPendingGate: true });
    const telemetry = new InMemoryTelemetrySink();
    const adapter = createIngestAdapter({ config, environment: "dev", telemetry, resolveProvider: fakeModel });

    const result = await adapter.transcribeImage({ imageBytes, mediaType: "image/png", prompt: "p", promptVersion: "v1" });

    expect(result.servedBy).toEqual({ providerId: "anthropic", modelId: "claude-haiku-4-5" });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const skipEvents = telemetry.events.filter((e) => e.type === "fallback" && e.reason === "unsupported_capability");
    expect(skipEvents).toHaveLength(1);
  });
});
