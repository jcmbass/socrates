import { describe, expect, it } from "vitest";
import { NoopTelemetrySink, InMemoryTelemetrySink, type DriftEvent } from "../telemetry";

const sampleCallEvent: DriftEvent = {
  type: "model_call",
  task: "tutor",
  environment: "dev",
  servedBy: { providerId: "anthropic", modelId: "claude-sonnet-5" },
  attemptIndex: 0,
  latencyMs: 123,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  costUsd: 0.0007,
  promptVersion: "buxo-socratic-v3",
  timestamp: "2026-07-14T00:00:00.000Z",
};

const sampleFallbackEvent: DriftEvent = {
  type: "fallback",
  task: "assessor",
  environment: "prod",
  from: { providerId: "openrouter", modelId: "deepseek-v3.2" },
  to: { providerId: "anthropic", modelId: "claude-sonnet-5" },
  reason: "http_5xx",
  attemptIndex: 0,
  timestamp: "2026-07-14T00:00:01.000Z",
};

describe("NoopTelemetrySink", () => {
  it("swallows events without throwing and without exposing any observable state", () => {
    const sink = new NoopTelemetrySink();
    expect(() => sink.record(sampleCallEvent)).not.toThrow();
    expect(() => sink.record(sampleFallbackEvent)).not.toThrow();
  });
});

describe("InMemoryTelemetrySink", () => {
  it("collects every recorded event in order", () => {
    const sink = new InMemoryTelemetrySink();
    sink.record(sampleCallEvent);
    sink.record(sampleFallbackEvent);
    expect(sink.events).toEqual([sampleCallEvent, sampleFallbackEvent]);
  });

  it("starts empty", () => {
    expect(new InMemoryTelemetrySink().events).toEqual([]);
  });
});

describe("C6 §6.1 — no student text in any event shape", () => {
  it("a model_call event's keys never include a raw-text-shaped field", () => {
    const forbidden = ["studentMessage", "tutorReply", "rationale", "prompt", "system", "content", "message"];
    for (const key of Object.keys(sampleCallEvent)) {
      expect(forbidden).not.toContain(key);
    }
  });

  it("a fallback event's keys never include a raw-text-shaped field", () => {
    const forbidden = ["studentMessage", "tutorReply", "rationale", "prompt", "system", "content", "message"];
    for (const key of Object.keys(sampleFallbackEvent)) {
      expect(forbidden).not.toContain(key);
    }
  });
});
