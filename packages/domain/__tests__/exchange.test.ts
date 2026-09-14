import { describe, expect, it } from "vitest";
import { ExchangeSchema, type Exchange } from "../exchange";
import { VERSION_SENTINEL_UNKNOWN_ALPHA_MIGRATED } from "../sentinels";

function makeExchange(overrides: Partial<Exchange> = {}): Exchange {
  return {
    id: "session-1:0",
    sessionId: "session-1",
    index: 0,
    timestamp: "2026-07-10T10:00:00.000Z",
    studentMessage: "No entiendo la regla de la cadena.",
    tutorReply: "¿Qué pasa si primero derivas la función externa?",
    band: "guiding",
    tutorPromptVersion: "buxo-socratic-v3",
    tutorModelId: "claude-sonnet-5",
    tutorProviderId: "anthropic-direct",
    hintOffered: null,
    studentCorrect: null,
    judgePromptVersion: null,
    judgeModelId: null,
    judgeProviderId: null,
    schemaVersion: 1,
    ...overrides,
  };
}

describe("ExchangeSchema", () => {
  it("accepts a well-formed Exchange with no judge verdict yet", () => {
    expect(ExchangeSchema.safeParse(makeExchange()).success).toBe(true);
  });

  it("accepts a fully judged Exchange", () => {
    const result = ExchangeSchema.safeParse(
      makeExchange({
        hintOffered: false,
        studentCorrect: true,
        judgePromptVersion: "judge-v2",
        judgeModelId: "claude-haiku-5",
        judgeProviderId: "anthropic-direct",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts the alfa-migration sentinel as a version value", () => {
    const result = ExchangeSchema.safeParse(
      makeExchange({
        tutorModelId: VERSION_SENTINEL_UNKNOWN_ALPHA_MIGRATED,
        tutorProviderId: VERSION_SENTINEL_UNKNOWN_ALPHA_MIGRATED,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a negative index", () => {
    expect(ExchangeSchema.safeParse(makeExchange({ index: -1 })).success).toBe(false);
  });

  it("rejects an empty tutorPromptVersion", () => {
    expect(ExchangeSchema.safeParse(makeExchange({ tutorPromptVersion: "" })).success).toBe(false);
  });
});
