/**
 * Unit tests for `src/models/assess.ts`'s `runAssessor` — F2 WQ3 parte B2.
 * Stubs `ModelDeps.createStructuredAdapter` directly (no "ai" mocking
 * needed, same spirit as `__tests__/models/fake-adapters.test.ts`) so the
 * assertions focus on what THIS module does with the result: opting the
 * prompt into `topicLabeling`, forwarding `ASSESSOR_PROMPT_VERSION`, and
 * extracting `topicKeyRaw` from the verdict.
 */
import { describe, expect, it } from "vitest";
import type { StructuredAdapter, StructuredCallParams, StructuredCallResult } from "@buxo/models/execution/structured";
import type { ModelRef } from "@buxo/models/task";
import { ASSESSOR_PROMPT_VERSION, runAssessor } from "../../src/models/assess";

const SERVED_BY: ModelRef = { providerId: "anthropic", modelId: "claude-sonnet-5" };

function stubModelDeps(result: StructuredCallResult<unknown>): { createStructuredAdapter: () => StructuredAdapter; capturedParams: StructuredCallParams<unknown>[] } {
  const capturedParams: StructuredCallParams<unknown>[] = [];
  return {
    capturedParams,
    createStructuredAdapter: () => ({
      generateStructured: async <T,>(params: StructuredCallParams<T>) => {
        capturedParams.push(params as StructuredCallParams<unknown>);
        return result as StructuredCallResult<T>;
      },
    }),
  };
}

const BASE_INPUT = { messages: [{ role: "user" as const, content: "no entiendo" }], currentBand: "guiding" as const, subject: "Cálculo I" };

describe("runAssessor — F2 WQ3 parte B2", () => {
  it("opts the system prompt into topicLabeling and forwards ASSESSOR_PROMPT_VERSION", async () => {
    const deps = stubModelDeps({
      ok: true,
      object: {
        demonstratedUnderstanding: "solid",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
        recommendedBand: "minimal",
        rationale: "ok",
        topicKey: "Regla de la cadena",
      },
      servedBy: SERVED_BY,
      promptVersion: ASSESSOR_PROMPT_VERSION,
      costUsd: 0.001,
    });

    const outcome = await runAssessor(deps, BASE_INPUT);

    expect(deps.capturedParams[0].system).toContain("topicKey");
    expect(deps.capturedParams[0].promptVersion).toBe(ASSESSOR_PROMPT_VERSION);
    expect(outcome.verdict?.demonstratedUnderstanding).toBe("solid");
    expect(outcome.topicKeyRaw).toBe("Regla de la cadena");
    expect(outcome.promptVersion).toBe(ASSESSOR_PROMPT_VERSION);
    expect(outcome.servedBy).toEqual(SERVED_BY);
    expect(outcome.costUsd).toBe(0.001);
  });

  it("topicKeyRaw is null when the model returns null for topicKey", async () => {
    const deps = stubModelDeps({
      ok: true,
      object: {
        demonstratedUnderstanding: "weak",
        explainedInOwnWords: false,
        guessedOrPatternMatched: true,
        recommendedBand: "guiding",
        rationale: "guess",
        topicKey: null,
      },
      servedBy: SERVED_BY,
      promptVersion: ASSESSOR_PROMPT_VERSION,
      costUsd: 0.001,
    });

    const outcome = await runAssessor(deps, BASE_INPUT);
    expect(outcome.topicKeyRaw).toBeNull();
  });

  it("degrade-to-null contract preserved: a failed chain returns verdict/topicKeyRaw/servedBy/promptVersion all null, but costUsd survives", async () => {
    const deps = stubModelDeps({ ok: false, servedBy: null, promptVersion: null, costUsd: 0.0003, error: "exhausted" });

    const outcome = await runAssessor(deps, BASE_INPUT);

    expect(outcome.verdict).toBeNull();
    expect(outcome.topicKeyRaw).toBeNull();
    expect(outcome.servedBy).toBeNull();
    expect(outcome.promptVersion).toBeNull();
    expect(outcome.costUsd).toBe(0.0003);
  });
});

/**
 * Beta real (2026-07-26): `failed` separa "la llamada al modelo falló" de
 * "corrió y no hubo veredicto utilizable". Los dos llegaban a `sessions.ts`
 * como `verdict: null` y ahí vive la guarda detrás de la cual está TODA la
 * cadena pedagógica del turno (assessment → mastery → racha → logros).
 *
 * Sin esta distinción, quedarse sin saldo de Anthropic borraba el registro
 * pedagógico completo SIN UNA SOLA LÍNEA DE LOG: `runAssessor` devuelve
 * nulos en vez de lanzar, así que el `.catch()` de `sessions.ts` nunca se
 * enteraba. El tutor seguía respondiendo (gemma no depende de Anthropic) y
 * el founder se quedaba con transcripciones y cero datos medibles.
 *
 * Si alguien vuelve a colapsar los dos casos, este test falla.
 */
describe("runAssessor — bandera `failed` (beta real)", () => {
  it("marca failed=true cuando la llamada al modelo falla", async () => {
    const deps = stubModelDeps({ ok: false, servedBy: null, promptVersion: null, costUsd: 0.0007, error: "exhausted" });

    const outcome = await runAssessor(deps, BASE_INPUT);

    expect(outcome.failed).toBe(true);
    expect(outcome.verdict).toBeNull();
    // El costo sobrevive al fallo: una cadena agotada igual quemó tokens.
    expect(outcome.costUsd).toBe(0.0007);
  });

  it("marca failed=false en el camino feliz", async () => {
    const deps = stubModelDeps({
      ok: true,
      object: {
        demonstratedUnderstanding: "solid",
        explainedInOwnWords: true,
        guessedOrPatternMatched: false,
        recommendedBand: "minimal",
        rationale: "explicó con sus palabras",
        topicKey: "derivadas",
      },
      servedBy: SERVED_BY,
      promptVersion: ASSESSOR_PROMPT_VERSION,
      costUsd: 0.003,
    });

    const outcome = await runAssessor(deps, BASE_INPUT);

    expect(outcome.failed).toBe(false);
    expect(outcome.verdict).not.toBeNull();
  });
});
