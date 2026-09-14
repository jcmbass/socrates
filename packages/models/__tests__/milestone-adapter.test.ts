import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LanguageModel } from "ai";

const { streamTextMock } = vi.hoisted(() => ({ streamTextMock: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: streamTextMock };
});

import { createMilestoneAdapter } from "../execution/milestone";
import { loadModelsConfig } from "../config";
import { InMemoryTelemetrySink } from "../telemetry";
import { MILESTONE_PROMPT_VERSION } from "@buxo/core/milestone-prompt";
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const BASE_PARAMS = {
  messages: [{ role: "user" as const, content: "listo para el repaso" }],
  subjectName: "Química 1",
  milestoneKind: "parcial" as const,
  milestoneTitle: "Parcial 1",
  topics: [
    { title: "Enlace iónico", order: 0, emphasis: false },
    { title: "Enlace covalente", order: 1, emphasis: true },
  ],
  sourcesText: "Guía de enlaces químicos: el enlace iónico se forma por transferencia de electrones.",
};

describe("createMilestoneAdapter.streamReply", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
  });

  it("serves the primary tutor-chain candidate and returns O-9 provenance under MILESTONE_PROMPT_VERSION", async () => {
    streamTextMock.mockReturnValue(makeStreamTextResult());
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createMilestoneAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    const reply = await adapter.streamReply(BASE_PARAMS);

    expect(reply.servedBy).toEqual({ providerId: "anthropic", modelId: "claude-sonnet-5" });
    expect(reply.promptVersion).toBe(MILESTONE_PROMPT_VERSION);
    expect(reply.promptVersion).not.toBe(PROMPT_VERSION);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });

  it("R2: the rendered system prompt is the milestone prompt, not the tutor's", async () => {
    streamTextMock.mockReturnValue(makeStreamTextResult());
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createMilestoneAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    await adapter.streamReply(BASE_PARAMS);

    const call = streamTextMock.mock.calls[0][0];
    const systemContent = typeof call.system === "string" ? call.system : call.system.content;
    expect(systemContent).toContain("Parcial 1");
    expect(systemContent).toContain("Enlace covalente [ÉNFASIS");
    expect(systemContent.toLowerCase()).not.toContain("in this band");
  });

  it("applies the Anthropic cache breakpoint when the serving candidate supports explicit_breakpoints", async () => {
    streamTextMock.mockReturnValue(makeStreamTextResult());
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createMilestoneAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    await adapter.streamReply(BASE_PARAMS);

    const call = streamTextMock.mock.calls[0][0];
    expect(call.system).toMatchObject({ providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } });
  });

  it("MANDATORY: falls back to the second candidate on a chain failure", async () => {
    streamTextMock
      .mockImplementationOnce(() => {
        throw new Error("503 service unavailable");
      })
      .mockReturnValueOnce(makeStreamTextResult());

    const config = loadModelsConfig({ raw: { tutor: "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5" }, environment: "dev" });
    const telemetry = new InMemoryTelemetrySink();
    const adapter = createMilestoneAdapter({ config, environment: "dev", telemetry, resolveProvider: fakeModel });

    const reply = await adapter.streamReply(BASE_PARAMS);

    expect(reply.servedBy).toEqual({ providerId: "anthropic", modelId: "claude-sonnet-5" });
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it("records a model_call telemetry event tagged with MILESTONE_PROMPT_VERSION", async () => {
    streamTextMock.mockReturnValue(
      makeStreamTextResult({ inputTokens: 2000, outputTokens: 1000, inputTokenDetails: { noCacheTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
    );
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const telemetry = new InMemoryTelemetrySink();
    const adapter = createMilestoneAdapter({ config, environment: "dev", telemetry, resolveProvider: fakeModel });

    await adapter.streamReply(BASE_PARAMS);
    await flush();

    const callEvents = telemetry.events.filter((e) => e.type === "model_call");
    expect(callEvents).toHaveLength(1);
    expect(callEvents[0]).toMatchObject({
      task: "tutor",
      servedBy: { providerId: "anthropic", modelId: "claude-sonnet-5" },
      promptVersion: MILESTONE_PROMPT_VERSION,
    });
  });

  it("throws ModelChainExhaustedError when the entire chain fails", async () => {
    streamTextMock.mockImplementation(() => {
      throw new Error("network unreachable");
    });
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createMilestoneAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    await expect(adapter.streamReply(BASE_PARAMS)).rejects.toThrow(/tutor.*chain failed/i);
  });

  it("DF-P11: an empty sourcesText still renders (antialucinación fallback), never throws", async () => {
    streamTextMock.mockReturnValue(makeStreamTextResult());
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    const adapter = createMilestoneAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    await expect(adapter.streamReply({ ...BASE_PARAMS, sourcesText: undefined })).resolves.toBeDefined();
    const call = streamTextMock.mock.calls[0][0];
    const systemContent = typeof call.system === "string" ? call.system : call.system.content;
    expect(systemContent).toContain("No study-material sources (Fuentes) exist");
  });
});
