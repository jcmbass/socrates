import { z } from "zod";
import { describe, expect, it } from "vitest";
import { MODEL_REGISTRY, lookupCapabilities, requireCapabilities, DEFAULT_FLOOR } from "../registry";
import { ModelCapabilitiesSchema } from "../capabilities";
import { isServableForTask } from "../gate";
import { ModelsConfigError } from "../errors";
import { TASK_KINDS } from "../task";

describe("MODEL_REGISTRY", () => {
  it("has no duplicate (providerId, modelId) rows", () => {
    const keys = MODEL_REGISTRY.map((r) => `${r.providerId}:${r.modelId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks the two Anthropic rows already used in apps/harness today as 'validated'", () => {
    expect(lookupCapabilities("anthropic", "claude-sonnet-5")?.gateStatus).toBe("validated");
    expect(lookupCapabilities("anthropic", "claude-haiku-4-5")?.gateStatus).toBe("validated");
  });

  it("marks every open-source/aggregator candidate from §1.6 as 'pending_gate' except the ones that PASSED a gate O-14 (ollama:gemma4:31b-cloud en BE2, deepinfra:Qwen3-VL en 2026-08-02) o validados por-tarea (gemma-4-31B-it y Qwen3.6 en F3)", () => {
    const gated = new Set(["ollama/gemma4:31b-cloud", "deepinfra/Qwen/Qwen3-VL-30B-A3B-Instruct"]);
    const perTask = new Set(["deepinfra/google/gemma-4-31B-it", "deepinfra/Qwen/Qwen3.6-35B-A3B", "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731"]);
    const pending = MODEL_REGISTRY.filter(
      (r) => r.providerId !== "anthropic" && !gated.has(`${r.providerId}/${r.modelId}`) && !perTask.has(`${r.providerId}/${r.modelId}`),
    );
    expect(pending.length).toBeGreaterThan(0);
    for (const row of pending) {
      expect(row.gateStatus).toBe("pending_gate");
    }
    // gemma-4-31B-it: mapa por-tarea — tutor/temario validated (gates F2
    // PASARON), assessor/judge pending (calibración FAIL).
    expect(lookupCapabilities("deepinfra", "google/gemma-4-31B-it")?.gateStatus).toEqual({
      tutor: "validated",
      "temario-builder": "validated",
      "guided-items": "pending_gate",
    });
    // Qwen3.6-35B-A3B: mapa por-tarea — assessor/judge/mastery-assessor
    // validated (diseño de dos modelos: Qwen alimenta la evidencia de mastery).
    expect(lookupCapabilities("deepinfra", "Qwen/Qwen3.6-35B-A3B")?.gateStatus).toEqual({
      assessor: "validated",
      judge: "validated",
      "mastery-assessor": "validated",
    });
    // DeepSeek-V4-Flash-0731: SOLO assessor (banda) — NO mastery-assessor
    // (la separación la hace cumplir la allowlist + el mapa por-tarea).
    expect(lookupCapabilities("deepinfra", "deepseek-ai/DeepSeek-V4-Flash-0731")?.gateStatus).toEqual({
      assessor: "validated",
      "guided-items": "pending_gate",
    });
    expect(isServableForTask(lookupCapabilities("deepinfra", "deepseek-ai/DeepSeek-V4-Flash-0731")!, "mastery-assessor", "prod", false)).toBe(false);
  });

  it("includes the deepinfra Qwen3-VL row as VALIDATED (gate O-14 aprobado 2026-08-02), per-token, con los precios confirmados", () => {
    const row = lookupCapabilities("deepinfra", "Qwen/Qwen3-VL-30B-A3B-Instruct");
    expect(row).toBeDefined();
    expect(row!.gateStatus).toBe("validated");
    // Invariante PB2: una fila validated per-token NO puede tener precios nulos
    // (si no, el costo se subcontaría en silencio).
    expect(row!.pricePerMTokIn).not.toBeNull();
    expect(row!.pricePerMTokOut).not.toBeNull();
    expect(row!.verifiedBy).toBe("gate_suite");
    expect(row!.costModel).toBe("per-token");
    expect(row!.pricePerMTokIn).toBe(0.15);
    expect(row!.pricePerMTokOut).toBe(0.6);
    expect(row!.vision).toBe(true);
    // Ingesta no necesita tools ni structured output — encargo explícito.
    expect(row!.toolUse).toBe(false);
    expect(row!.structuredOutputSupport).toBe("none");
    expect(row!.fixedCostRef).toBeNull();
  });

  it("forces native structured outputs for both Anthropic rows (the fase-4 fix, applied by registry data, not by a route-level literal)", () => {
    expect(lookupCapabilities("anthropic", "claude-sonnet-5")?.structuredOutputForce).toEqual({
      anthropic: { structuredOutputMode: "outputFormat" },
    });
    expect(lookupCapabilities("anthropic", "claude-haiku-4-5")?.structuredOutputForce).toEqual({
      anthropic: { structuredOutputMode: "outputFormat" },
    });
  });

  it("never fabricates a price the spec didn't give a point estimate for (Mistral rows)", () => {
    const mistralSmall = lookupCapabilities("mistral", "mistral-small-latest");
    expect(mistralSmall?.pricePerMTokIn).toBeNull();
    expect(mistralSmall?.pricePerMTokOut).toBeNull();
  });

  it("never fabricates a context/output token ceiling for any row (spec §1.2/§1.6 states none)", () => {
    for (const row of MODEL_REGISTRY) {
      expect(row.maxContextTokens).toBeNull();
      expect(row.maxOutputTokens).toBeNull();
    }
  });

  it("PB2: every validated per-token row has non-null prices (import-crash invariant); self-hosted rows have null prices + fixedCostRef", () => {
    for (const row of MODEL_REGISTRY) {
      // Con gateStatus por-tarea (F3): validated en UN mapa parcial alcanza
      // para exigir el costo — el modelo ya sirve tráfico en esa tarea.
      const validatedAnywhere =
        typeof row.gateStatus === "string"
          ? row.gateStatus === "validated"
          : Object.values(row.gateStatus).includes("validated");
      if (!validatedAnywhere) continue;
      if (row.costModel === "per-token") {
        expect(row.pricePerMTokIn).not.toBeNull();
        expect(row.pricePerMTokOut).not.toBeNull();
      } else if (row.costModel === "self-hosted") {
        expect(row.pricePerMTokIn).toBeNull();
        expect(row.pricePerMTokOut).toBeNull();
        expect(row.fixedCostRef).not.toBeNull();
        expect(row.fixedCostRef).not.toBe("");
      }
    }
  });

  it("PB2: pending_gate with null prices does NOT crash the refine (dev OK)", () => {
    const schema = ModelCapabilitiesSchema.array().superRefine((rows, ctx) => {
      for (const [i, row] of rows.entries()) {
        if (row.gateStatus === "validated" && row.costModel === "per-token" && (row.pricePerMTokIn === null || row.pricePerMTokOut === null)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `validated without price at row ${i}`,
            path: [i],
          });
        }
      }
    });
    const pendingRow = {
      providerId: "ollama",
      modelId: "gemma4:31b-cloud",
      structuredOutputSupport: "none" as const,
      structuredOutputForce: null,
      toolUse: false,
      vision: false,
      streaming: true,
      promptCaching: "none" as const,
      maxContextTokens: null,
      maxOutputTokens: null,
      pricePerMTokIn: null,
      pricePerMTokOut: null,
      costModel: "per-token" as const,
      fixedCostRef: null,
      notes: "test pending_gate with null prices",
      verifiedAt: "2026-07-17",
      verifiedBy: "manual_docs_review" as const,
      gateStatus: "pending_gate" as const,
    };
    expect(() => schema.parse([pendingRow])).not.toThrow();
  });

  it("PB2: validated per-token with null pricePerMTokIn DOES crash the refine (fail-loud)", () => {
    const schema = ModelCapabilitiesSchema.array().superRefine((rows, ctx) => {
      for (const [i, row] of rows.entries()) {
        if (row.gateStatus === "validated" && row.costModel === "per-token" && (row.pricePerMTokIn === null || row.pricePerMTokOut === null)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `validated without price at row ${i}`,
            path: [i],
          });
        }
      }
    });
    const badRow = {
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
      structuredOutputSupport: "native_schema" as const,
      structuredOutputForce: { anthropic: { structuredOutputMode: "outputFormat" } },
      toolUse: true,
      vision: true,
      streaming: true,
      promptCaching: "explicit_breakpoints" as const,
      maxContextTokens: null,
      maxOutputTokens: null,
      pricePerMTokIn: null,
      pricePerMTokOut: 10,
      costModel: "per-token" as const,
      fixedCostRef: null,
      notes: "test validated with null priceIn",
      verifiedAt: "2026-07-17",
      verifiedBy: "manual_docs_review" as const,
      gateStatus: "validated" as const,
    };
    expect(() => schema.parse([badRow])).toThrow();
  });

  it("PB2: validated per-token with null pricePerMTokOut also crashes the refine", () => {
    const schema = ModelCapabilitiesSchema.array().superRefine((rows, ctx) => {
      for (const [i, row] of rows.entries()) {
        if (row.gateStatus === "validated" && row.costModel === "per-token" && (row.pricePerMTokIn === null || row.pricePerMTokOut === null)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `validated without price at row ${i}`,
            path: [i],
          });
        }
      }
    });
    const badRow = {
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
      structuredOutputSupport: "native_schema" as const,
      structuredOutputForce: { anthropic: { structuredOutputMode: "outputFormat" } },
      toolUse: true,
      vision: true,
      streaming: true,
      promptCaching: "explicit_breakpoints" as const,
      maxContextTokens: null,
      maxOutputTokens: null,
      pricePerMTokIn: 2,
      pricePerMTokOut: null,
      costModel: "per-token" as const,
      fixedCostRef: null,
      notes: "test validated with null priceOut",
      verifiedAt: "2026-07-17",
      verifiedBy: "manual_docs_review" as const,
      gateStatus: "validated" as const,
    };
    expect(() => schema.parse([badRow])).toThrow();
  });

  // --- F3 G5: self-hosted invariant tests ---

  it("PB2: validated self-hosted with null prices and fixedCostRef is OK", () => {
    const schema = ModelCapabilitiesSchema.array().superRefine((rows, ctx) => {
      for (const [i, row] of rows.entries()) {
        if (row.gateStatus !== "validated") continue;
        if (row.costModel === "self-hosted") {
          if (row.pricePerMTokIn !== null || row.pricePerMTokOut !== null) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `self-hosted with non-null price at row ${i}`, path: [i] });
          }
          if (row.fixedCostRef === null || row.fixedCostRef === "") {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `self-hosted without fixedCostRef at row ${i}`, path: [i] });
          }
        }
      }
    });
    const selfHostedRow = {
      providerId: "ollama",
      modelId: "gemma4:31b-local",
      structuredOutputSupport: "none" as const,
      structuredOutputForce: null,
      toolUse: false,
      vision: false,
      streaming: true,
      promptCaching: "none" as const,
      maxContextTokens: null,
      maxOutputTokens: null,
      pricePerMTokIn: null,
      pricePerMTokOut: null,
      costModel: "self-hosted" as const,
      fixedCostRef: "VPS-1: NVIDIA A100 80GB @ USD 1,200/mes",
      notes: "test self-hosted row with fixedCostRef",
      verifiedAt: "2026-07-18",
      verifiedBy: "manual_docs_review" as const,
      gateStatus: "validated" as const,
    };
    expect(() => schema.parse([selfHostedRow])).not.toThrow();
  });

  it("PB2: validated self-hosted WITHOUT fixedCostRef crashes the refine", () => {
    const schema = ModelCapabilitiesSchema.array().superRefine((rows, ctx) => {
      for (const [i, row] of rows.entries()) {
        if (row.gateStatus !== "validated") continue;
        if (row.costModel === "self-hosted") {
          if (row.fixedCostRef === null || row.fixedCostRef === "") {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `self-hosted without fixedCostRef at row ${i}`, path: [i] });
          }
        }
      }
    });
    const badRow = {
      providerId: "ollama",
      modelId: "gemma4:31b-local",
      structuredOutputSupport: "none" as const,
      structuredOutputForce: null,
      toolUse: false,
      vision: false,
      streaming: true,
      promptCaching: "none" as const,
      maxContextTokens: null,
      maxOutputTokens: null,
      pricePerMTokIn: null,
      pricePerMTokOut: null,
      costModel: "self-hosted" as const,
      fixedCostRef: null,
      notes: "test self-hosted without fixedCostRef",
      verifiedAt: "2026-07-18",
      verifiedBy: "manual_docs_review" as const,
      gateStatus: "validated" as const,
    };
    expect(() => schema.parse([badRow])).toThrow();
  });

  it("PB2: validated self-hosted with non-null prices crashes the refine", () => {
    const schema = ModelCapabilitiesSchema.array().superRefine((rows, ctx) => {
      for (const [i, row] of rows.entries()) {
        if (row.gateStatus !== "validated") continue;
        if (row.costModel === "self-hosted") {
          if (row.pricePerMTokIn !== null || row.pricePerMTokOut !== null) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `self-hosted with non-null price at row ${i}`, path: [i] });
          }
        }
      }
    });
    const badRow = {
      providerId: "ollama",
      modelId: "gemma4:31b-local",
      structuredOutputSupport: "none" as const,
      structuredOutputForce: null,
      toolUse: false,
      vision: false,
      streaming: true,
      promptCaching: "none" as const,
      maxContextTokens: null,
      maxOutputTokens: null,
      pricePerMTokIn: 0.27,
      pricePerMTokOut: null,
      costModel: "self-hosted" as const,
      fixedCostRef: "VPS-1",
      notes: "test self-hosted with non-null priceIn",
      verifiedAt: "2026-07-18",
      verifiedBy: "manual_docs_review" as const,
      gateStatus: "validated" as const,
    };
    expect(() => schema.parse([badRow])).toThrow();
  });

  it("PB2: pending_gate self-hosted with null prices and no fixedCostRef is OK (dev)", () => {
    const schema = ModelCapabilitiesSchema.array().superRefine((rows, ctx) => {
      for (const [i, row] of rows.entries()) {
        if (row.gateStatus !== "validated") continue;
        if (row.costModel === "self-hosted") {
          if (row.fixedCostRef === null || row.fixedCostRef === "") {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `self-hosted without fixedCostRef at row ${i}`, path: [i] });
          }
        }
      }
    });
    const pendingSelfHosted = {
      providerId: "ollama",
      modelId: "gemma4:31b-local",
      structuredOutputSupport: "none" as const,
      structuredOutputForce: null,
      toolUse: false,
      vision: false,
      streaming: true,
      promptCaching: "none" as const,
      maxContextTokens: null,
      maxOutputTokens: null,
      pricePerMTokIn: null,
      pricePerMTokOut: null,
      costModel: "self-hosted" as const,
      fixedCostRef: null,
      notes: "test pending_gate self-hosted without fixedCostRef",
      verifiedAt: "2026-07-18",
      verifiedBy: "manual_docs_review" as const,
      gateStatus: "pending_gate" as const,
    };
    expect(() => schema.parse([pendingSelfHosted])).not.toThrow();
  });

  it("includes the ollama:gemma4:31b-cloud row as validated with self-hosted costModel (BE2 gate O-14 tutor PASS)", () => {
    const row = lookupCapabilities("ollama", "gemma4:31b-cloud");
    expect(row).toBeDefined();
    expect(row!.gateStatus).toBe("validated");
    expect(row!.pricePerMTokIn).toBeNull();
    expect(row!.pricePerMTokOut).toBeNull();
    expect(row!.costModel).toBe("self-hosted");
    expect(row!.fixedCostRef).toBe("Ollama cloud subscription (founder, 2026-07)");
    expect(row!.structuredOutputSupport).toBe("none");
    expect(row!.toolUse).toBe(false);
    expect(row!.vision).toBe(false);
    expect(row!.streaming).toBe(true);
    expect(row!.promptCaching).toBe("none");
  });
});

describe("lookupCapabilities / requireCapabilities", () => {
  it("lookupCapabilities returns undefined for an unregistered pair", () => {
    expect(lookupCapabilities("acme", "made-up")).toBeUndefined();
  });

  it("requireCapabilities returns the row for a registered pair", () => {
    expect(requireCapabilities("tutor", { providerId: "anthropic", modelId: "claude-sonnet-5" }).gateStatus).toBe(
      "validated",
    );
  });

  it("requireCapabilities THROWS ModelsConfigError with the offending pair for an unregistered pair", () => {
    expect(() => requireCapabilities("assessor", { providerId: "acme", modelId: "made-up" })).toThrow(
      ModelsConfigError,
    );
    expect(() => requireCapabilities("assessor", { providerId: "acme", modelId: "made-up" })).toThrow(/acme/);
    expect(() => requireCapabilities("assessor", { providerId: "acme", modelId: "made-up" })).toThrow(/made-up/);
  });
});

describe("gateStatus por-tarea (F3 migración DeepInfra) — guardia anti-contaminación", () => {
  const gemma = lookupCapabilities("deepinfra", "google/gemma-4-31B-it")!;

  it("gemma es servible como tutor y temario-builder en prod (sus gates PASARON: tutor 5/5, toolUse medido)", () => {
    expect(isServableForTask(gemma, "tutor", "prod", false)).toBe(true);
    expect(isServableForTask(gemma, "temario-builder", "prod", false)).toBe(true);
  });

  it("gemma NO es servible como guided-items en prod (no hay gate de esta tarea — pending_gate)", () => {
    expect(isServableForTask(gemma, "guided-items", "prod", false)).toBe(false);
    expect(isServableForTask(gemma, "guided-items", "dev", true)).toBe(true);
  });

  it("DeepSeek-V4-Flash-0731 is pending_gate for guided-items and remains validated for assessor", () => {
    const row = lookupCapabilities("deepinfra", "deepseek-ai/DeepSeek-V4-Flash-0731")!;
    expect(isServableForTask(row, "assessor", "prod", false)).toBe(true);
    expect(isServableForTask(row, "guided-items", "prod", false)).toBe(false);
    expect(isServableForTask(row, "guided-items", "dev", true)).toBe(true);
  });

  it("gemma SÍ es medible como assessor en dev + devAllowPendingGate (el gate corre en dev)", () => {
    expect(isServableForTask(gemma, "assessor", "dev", true)).toBe(true);
    // pero en staging NO: la flag solo vale en dev (loadModelsConfig lo exige)
    expect(isServableForTask(gemma, "assessor", "staging", true)).toBe(false);
  });

  it("el valor único sigue significando igual para toda tarea (filas pre-migración sin cambio de comportamiento)", () => {
    const ollama = lookupCapabilities("ollama", "gemma4:31b-cloud")!;
    expect(ollama.gateStatus).toBe("validated"); // sigue siendo valor único, no mapa
    for (const task of TASK_KINDS) {
      expect(isServableForTask(ollama, task, "prod", false)).toBe(true);
    }
    const qwen = lookupCapabilities("deepinfra", "Qwen/Qwen3-VL-30B-A3B-Instruct")!;
    expect(qwen.gateStatus).toBe("validated");
    expect(isServableForTask(qwen, "ingest", "prod", false)).toBe(true);
  });
});

describe("DEFAULT_FLOOR", () => {
  it("has an entry for every TaskKind, and every floor entry is itself in the registry", () => {
    for (const task of TASK_KINDS) {
      const floor = DEFAULT_FLOOR[task];
      expect(floor).toBeDefined();
      expect(lookupCapabilities(floor.providerId, floor.modelId)).toBeDefined();
    }
  });

  it("floors tutor/assessor/judge on Sonnet 5 and ingest/safety on Haiku 4.5, per §1.3's non-configurable floor", () => {
    expect(DEFAULT_FLOOR.tutor).toEqual({ providerId: "anthropic", modelId: "claude-sonnet-5" });
    expect(DEFAULT_FLOOR.assessor).toEqual({ providerId: "anthropic", modelId: "claude-sonnet-5" });
    expect(DEFAULT_FLOOR.judge).toEqual({ providerId: "anthropic", modelId: "claude-sonnet-5" });
    expect(DEFAULT_FLOOR.ingest).toEqual({ providerId: "anthropic", modelId: "claude-haiku-4-5" });
    expect(DEFAULT_FLOOR.safety).toEqual({ providerId: "anthropic", modelId: "claude-haiku-4-5" });
    expect(DEFAULT_FLOOR["guided-items"]).toEqual({
      providerId: "deepinfra",
      modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
    });
  });

  it("every floor entry is validated for its specific task except the guided-items pending placeholder", () => {
    for (const task of TASK_KINDS) {
      if (task === "guided-items") continue;
      const floor = DEFAULT_FLOOR[task];
      expect(isServableForTask(lookupCapabilities(floor.providerId, floor.modelId)!, task, "prod", false)).toBe(true);
    }
    const deepseek = lookupCapabilities("deepinfra", "deepseek-ai/DeepSeek-V4-Flash-0731")!;
    expect(isServableForTask(deepseek, "guided-items", "prod", false)).toBe(false);
    expect(isServableForTask(deepseek, "assessor", "prod", false)).toBe(true);
    const gemma = lookupCapabilities("deepinfra", "google/gemma-4-31B-it")!;
    expect(isServableForTask(gemma, "guided-items", "prod", false)).toBe(false);
  });
});
