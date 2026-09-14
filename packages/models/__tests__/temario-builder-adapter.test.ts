/**
 * Tests for the provider-agnostic temario-builder adapter — P2.
 *
 * All model-API calls are mocked via `vi.mock("ai", ...)`; zero real provider
 * calls happen here.
 *
 * P2 FIX1 (2026-07-21 post-real-run REVIEW): every test here configures an
 * EXPLICIT single-model `temarioBuilder` chain — `loadModelsConfig({raw:{}})`
 * no longer resolves this task to `[floor]` (the floor is never appended,
 * see `../config.ts`'s `skipFloor`), so an empty raw config would resolve to
 * `[]` and every call would fail before ever reaching `generateText`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { AnyToolDefinition } from "../tools";

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: generateTextMock };
});

import { modelMessageSchema } from "ai";
import { createTemarioBuilderAdapter } from "../execution/temario-builder";
import { loadModelsConfig } from "../config";

function fakeModel(): LanguageModel {
  return { modelId: "fake" } as unknown as LanguageModel;
}

function makeToolCall(toolName: string, input: unknown, toolCallId = `call-${toolName}`) {
  return {
    type: "tool-call" as const,
    toolCallId,
    toolName,
    input,
  };
}

function makeGenerateTextResult(
  text: string,
  toolCalls: ReturnType<typeof makeToolCall>[] = [],
  usage = { inputTokens: 100, outputTokens: 50 },
) {
  return {
    text,
    toolCalls,
    usage,
  };
}

// P2 FIX3: fixture tools no longer take `subjectId` as an input field — the
// real tools read it off `ctx.subjectId`, and these fixtures mirror that.
const createTopicTool = {
  name: "createTopic",
  description: "Create a topic",
  parameters: z.object({ title: z.string() }),
  execute: async (_ctx: unknown, input: { title: string }) => ({
    created: true,
    ...input,
  }),
} as AnyToolDefinition<unknown>;

const createMilestoneTool = {
  name: "createMilestone",
  description: "Create a milestone",
  parameters: z.object({
    title: z.string(),
    kind: z.enum(["parcial", "examen_final"]),
    coversUpToOrder: z.number(),
  }),
  execute: async (_ctx: unknown, input: { title: string; kind: "parcial" | "examen_final"; coversUpToOrder: number }) => ({
    created: true,
    ...input,
  }),
} as AnyToolDefinition<unknown>;

describe("createTemarioBuilderAdapter.generateTemario", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it("runs a multi-step tool loop and returns the final text", async () => {
    generateTextMock
      .mockResolvedValueOnce(
        makeGenerateTextResult("", [
          makeToolCall("createTopic", { title: "T1" }, "c1"),
          makeToolCall("createMilestone", { title: "P1", kind: "parcial", coversUpToOrder: 0 }, "c2"),
        ]),
      )
      .mockResolvedValueOnce(makeGenerateTextResult("Temario completo", []));

    const config = loadModelsConfig({ raw: { temarioBuilder: "anthropic:claude-sonnet-5" }, environment: "dev" });
    const adapter = createTemarioBuilderAdapter({
      config,
      environment: "dev",
      resolveProvider: fakeModel,
    });

    const result = await adapter.generateTemario({
      system: "Sos un asistente",
      prompt: "Programa:\n\nTema 1",
      tools: [createTopicTool, createMilestoneTool],
      toolContext: { db: {}, userId: "u1", subjectId: "s1" },
      subjectId: "s1",
      promptVersion: "temario-builder-v2",
    });

    expect(result.text).toBe("Temario completo");
    expect(result.promptVersion).toBe("temario-builder-v2");
    expect(result.servedBy).toEqual({ providerId: "anthropic", modelId: "claude-sonnet-5" });
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it("stops after the first model response with no tool calls", async () => {
    generateTextMock.mockResolvedValueOnce(makeGenerateTextResult("Nada que crear", []));

    const config = loadModelsConfig({ raw: { temarioBuilder: "anthropic:claude-sonnet-5" }, environment: "dev" });
    const adapter = createTemarioBuilderAdapter({
      config,
      environment: "dev",
      resolveProvider: fakeModel,
    });

    const result = await adapter.generateTemario({
      system: "Sos un asistente",
      prompt: "Programa vacío",
      tools: [createTopicTool],
      toolContext: { db: {}, userId: "u1", subjectId: "s1" },
      subjectId: "s1",
      promptVersion: "temario-builder-v2",
    });

    expect(result.text).toBe("Nada que crear");
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  // P2 real-API bug #6 (2026-07-21): the tool-result message pushed between
  // turns must be a valid `ai` ModelMessage — its `output` a discriminated
  // ToolResultOutput ({type:"json", value}), NOT the raw tool return. A bare
  // row typechecks but fails ai's real validation on the next turn. This test
  // validates the actual message the loop builds against ai's own schema, so
  // it reproduces the bug OFFLINE (no real API spend).
  it("builds tool-result messages that pass ai's ModelMessage schema", async () => {
    let secondTurnMessages: unknown[] | undefined;
    generateTextMock
      .mockImplementationOnce(() =>
        Promise.resolve(
          makeGenerateTextResult("", [makeToolCall("createTopic", { title: "Estructura atómica" }, "c1")]),
        ),
      )
      .mockImplementationOnce((args: { messages: unknown[] }) => {
        // Capture the messages the loop assembled AFTER running the tool.
        secondTurnMessages = args.messages;
        return Promise.resolve(makeGenerateTextResult("listo", []));
      });

    const config = loadModelsConfig({ raw: { temarioBuilder: "anthropic:claude-sonnet-5" }, environment: "dev" });
    const adapter = createTemarioBuilderAdapter({ config, environment: "dev", resolveProvider: fakeModel });

    await adapter.generateTemario({
      system: "Sos un asistente",
      prompt: "Programa:\n\nTema 1",
      tools: [createTopicTool],
      toolContext: { db: {}, userId: "u1", subjectId: "s1" },
      subjectId: "s1",
      promptVersion: "temario-builder-v2",
    });

    const toolMessage = secondTurnMessages?.find(
      (m): m is { role: string } => typeof m === "object" && m !== null && (m as { role?: string }).role === "tool",
    );
    expect(toolMessage).toBeDefined();
    // ai's own schema is the ground truth the real provider path uses.
    const parsed = modelMessageSchema.safeParse(toolMessage);
    expect(parsed.success).toBe(true);
  });

  it("throws ModelChainExhaustedError when the chain fails", async () => {
    generateTextMock.mockRejectedValue(new Error("network unreachable"));

    const config = loadModelsConfig({ raw: { temarioBuilder: "anthropic:claude-sonnet-5" }, environment: "dev" });
    const adapter = createTemarioBuilderAdapter({
      config,
      environment: "dev",
      resolveProvider: fakeModel,
    });

    await expect(
      adapter.generateTemario({
        system: "Sos un asistente",
        prompt: "Programa",
        tools: [createTopicTool],
        toolContext: { db: {}, userId: "u1", subjectId: "s1" },
        subjectId: "s1",
        promptVersion: "temario-builder-v2",
      }),
    ).rejects.toThrow(/temario-builder.*chain failed/i);
  });

  describe("P2 FIX1 — no cross-model failover for a stateful builder", () => {
    it("fails loud after the SINGLE configured candidate, without any 2nd attempt on another model", async () => {
      // A tool-call failure mid-construction (the exact real-run bug: a
      // duplicate createTopic call after 10 topics were already committed)
      // must not trigger a retry on a different model — it must propagate
      // straight to ModelChainExhaustedError.
      generateTextMock.mockResolvedValueOnce(
        makeGenerateTextResult("", [makeToolCall("createTopic", { title: "Estructura atómica" }, "c1")]),
      );

      const failingTopicTool = {
        name: "createTopic",
        description: "Create a topic",
        parameters: z.object({ title: z.string() }),
        execute: async () => {
          throw new Error("temas_temario_id_order_unique violation");
        },
      } as AnyToolDefinition<unknown>;

      const config = loadModelsConfig({ raw: { temarioBuilder: "anthropic:claude-haiku-4-5" }, environment: "dev" });
      const adapter = createTemarioBuilderAdapter({
        config,
        environment: "dev",
        resolveProvider: fakeModel,
      });

      await expect(
        adapter.generateTemario({
          system: "Sos un asistente",
          prompt: "Programa",
          tools: [failingTopicTool],
          toolContext: { db: {}, userId: "u1", subjectId: "s1" },
          subjectId: "s1",
          promptVersion: "temario-builder-v2",
        }),
      ).rejects.toThrow(/all 1 candidate\(s\)/i);

      // Exactly one `generateText` call — the chain never advanced to
      // reconstruct the loop from scratch on a second candidate.
      expect(generateTextMock).toHaveBeenCalledTimes(1);
    });

    it("resolveChain for temario-builder never contains the Sonnet floor", () => {
      const config = loadModelsConfig({ raw: { temarioBuilder: "anthropic:claude-haiku-4-5" }, environment: "dev" });
      expect(config.chains["temario-builder"]).toEqual([{ providerId: "anthropic", modelId: "claude-haiku-4-5" }]);
      expect(config.chains["temario-builder"]).toHaveLength(1);
    });

    it("resolves to an EMPTY chain (not the Sonnet floor) when nothing is configured", () => {
      const config = loadModelsConfig({ raw: {}, environment: "dev" });
      expect(config.chains["temario-builder"]).toEqual([]);
    });

    it("rejects a multi-model temario-builder chain at config-load time (fail-loud)", () => {
      expect(() =>
        loadModelsConfig({
          raw: { temarioBuilder: "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5" },
          environment: "dev",
        }),
      ).toThrow(/temario-builder.*multi-model chain/i);
    });
  });
});
