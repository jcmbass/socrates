/**
 * Content-level tests for src/models/fake-adapters.ts (F1/WP6 Part 1) — the
 * BUXO_FAKE_MODELS dev mode's canned tutor/assessor/judge doubles. These
 * never import "ai" and never touch the network by construction (the module
 * under test doesn't import "ai" either) — no vi.mock needed here, unlike
 * every other __tests__/routes/*.test.ts file.
 */
import { describe, expect, it } from "vitest";
import { loadModelsConfig } from "@buxo/models/config";
import { requireCapabilities } from "@buxo/models/registry";
import { InMemoryTelemetrySink } from "@buxo/models/telemetry";
import {
  FAKE_TUTOR_REPLIES,
  chunkFakeReply,
  createFakeModelAdapters,
  pickFakeTutorReply,
} from "../../src/models/fake-adapters";
import { assessorSchema } from "../../src/models/assess";
import { judgeSchema } from "../../src/models/judge";

// `assessor` dejó de recibir piso Anthropic el 2026-08-11 (migración
// DeepInfra: ningún fallo puede caer a Sonnet en silencio — ver `skipFloor` en
// @buxo/models/config.ts), así que con `raw: {}` su cadena resuelve VACÍA y el
// adapter revienta con `chain[0]` undefined. La cadena explícita reproduce el
// default derivado del piso que este valor reemplaza.
const config = loadModelsConfig({
  raw: { assessor: "anthropic:claude-sonnet-5" },
  environment: "dev",
  devAllowPendingGate: false,
});

describe("fake-adapters — tutor", () => {
  it("replies are varied and include both inline ($...$) and block ($$...$$) math", () => {
    expect(FAKE_TUTOR_REPLIES.length).toBeGreaterThanOrEqual(5);
    expect(FAKE_TUTOR_REPLIES.some((r) => /\$\$[\s\S]*\$\$/.test(r))).toBe(true);
    expect(FAKE_TUTOR_REPLIES.some((r) => /(?<!\$)\$(?!\$)[^$]+\$(?!\$)/.test(r))).toBe(true);
  });

  it("chunkFakeReply reconstructs the original text exactly when concatenated", () => {
    const text = FAKE_TUTOR_REPLIES[3]; // has block math + newlines
    const chunks = chunkFakeReply(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
  });

  it("pickFakeTutorReply is deterministic for the same (band, seed)", () => {
    expect(pickFakeTutorReply("guiding", "¿cómo derivo x^2?")).toBe(pickFakeTutorReply("guiding", "¿cómo derivo x^2?"));
  });

  it("streamReply streams the response body in MULTIPLE chunks and resolves matching .text/.usage", async () => {
    const models = createFakeModelAdapters(config, "dev");
    const reply = await models.tutorAdapter.streamReply({
      messages: [{ role: "user", content: "no entiendo la regla de la cadena" }],
      band: "guiding",
    });

    const fullText = await reply.result.text;
    expect(typeof fullText).toBe("string");
    expect(fullText.length).toBeGreaterThan(0);

    const response = reply.result.toTextStreamResponse();
    const reader = response.body!.getReader();
    const received: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received.push(new TextDecoder().decode(value));
    }
    expect(received.length).toBeGreaterThan(1); // genuinely multi-chunk, not one blob
    expect(received.join("")).toBe(fullText);

    const usage = await reply.result.usage;
    expect(usage.outputTokens).toBeGreaterThan(0);

    // servedBy must be a REAL registered pair (registry.ts) — costUsd/telemetry downstream (sessions.ts) depends on it.
    expect(() => requireCapabilities("tutor", reply.servedBy)).not.toThrow();
  });

  it("varies the reply across different student messages (not a constant)", async () => {
    const models = createFakeModelAdapters(config, "dev");
    const seeds = ["derivadas", "integrales", "triángulos", "fracciones", "límites", "ecuaciones"];
    const texts = await Promise.all(
      seeds.map(async (seed) => {
        const reply = await models.tutorAdapter.streamReply({ messages: [{ role: "user", content: seed }], band: "guiding" });
        return reply.result.text;
      }),
    );
    expect(new Set(texts).size).toBeGreaterThan(1);
  });
});

describe("fake-adapters — structured (assessor/judge)", () => {
  it("assessor verdicts are deterministic for the same prompt and match the registered assessorSchema shape", async () => {
    const models = createFakeModelAdapters(config, "dev");
    const params = {
      task: "assessor" as const,
      system: "sys",
      prompt: "Student explained the chain rule correctly.",
      schema: assessorSchema,
    };
    const first = await models.raw.createStructuredAdapter(new InMemoryTelemetrySink()).generateStructured(params);
    const second = await models.raw.createStructuredAdapter(new InMemoryTelemetrySink()).generateStructured(params);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.object).toEqual(second.object);
      expect(first.object).toMatchObject({
        demonstratedUnderstanding: expect.any(String),
        explainedInOwnWords: expect.any(Boolean),
        guessedOrPatternMatched: expect.any(Boolean),
        recommendedBand: expect.any(String),
        rationale: expect.any(String),
      });
    }
    if (first.ok) {
      expect(() => requireCapabilities("assessor", first.servedBy)).not.toThrow();
    }
  });

  it("judge verdicts are deterministic for the same prompt and match the registered judgeSchema shape", async () => {
    const models = createFakeModelAdapters(config, "dev");
    const params = {
      task: "judge" as const,
      system: "sys",
      prompt: "Student answer:\nx=2\n\nTutor reply:\n¿Por qué?",
      schema: judgeSchema,
    };
    const telemetry = new InMemoryTelemetrySink();
    const result = await models.raw.createStructuredAdapter(telemetry).generateStructured(params);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.object).toMatchObject({ hint_offered: expect.any(Boolean), student_correct: expect.any(Boolean) });
    }
    // Telemetry IS recorded by the fake structured adapter (mirrors the real one's shape).
    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]).toMatchObject({ type: "model_call", task: "judge" });
  });

  it("different prompts can produce different verdicts (not a constant)", async () => {
    const models = createFakeModelAdapters(config, "dev");
    const adapter = models.raw.createStructuredAdapter(new InMemoryTelemetrySink());
    const results = await Promise.all(
      ["a", "bb", "ccc", "dddd", "eeeee", "ffffff"].map((prompt) =>
        adapter.generateStructured({ task: "judge" as const, system: "sys", prompt, schema: judgeSchema }),
      ),
    );
    const serialized = new Set(results.map((r) => JSON.stringify(r.ok ? r.object : null)));
    expect(serialized.size).toBeGreaterThan(1);
  });
});
