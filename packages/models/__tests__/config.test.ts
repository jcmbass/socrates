import { describe, expect, it } from "vitest";
import { loadModelsConfig, parseChainString, resolveChain, RawModelsConfigSchema } from "../config";
import { ModelsConfigError } from "../errors";
import { DEFAULT_FLOOR } from "../registry";

describe("parseChainString", () => {
  it("parses a well-formed provider:model,provider:model chain", () => {
    expect(parseChainString("openrouter:deepseek-v3.2,anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5")).toEqual([
      { providerId: "openrouter", modelId: "deepseek-v3.2" },
      { providerId: "anthropic", modelId: "claude-haiku-4-5" },
      { providerId: "anthropic", modelId: "claude-sonnet-5" },
    ]);
  });

  it("trims whitespace around entries", () => {
    expect(parseChainString(" anthropic:claude-sonnet-5 , anthropic:claude-haiku-4-5 ")).toEqual([
      { providerId: "anthropic", modelId: "claude-sonnet-5" },
      { providerId: "anthropic", modelId: "claude-haiku-4-5" },
    ]);
  });

  it("returns null for an empty string", () => {
    expect(parseChainString("")).toBeNull();
    expect(parseChainString("   ")).toBeNull();
  });

  it("returns null for an entry missing a colon (malformed, not fail-loud)", () => {
    expect(parseChainString("anthropic-claude-sonnet-5")).toBeNull();
  });

  it("returns null when a provider or model half is empty", () => {
    expect(parseChainString(":claude-sonnet-5")).toBeNull();
    expect(parseChainString("anthropic:")).toBeNull();
  });

  it("splits on the FIRST colon only, so a modelId containing '/' (deepinfra:Qwen/Qwen3-VL-30B-A3B-Instruct) parses correctly", () => {
    // Trampa conocida (encargo DeepInfra, 2026-08-01): el modelId de DeepInfra
    // trae un '/' inusual en este código (org/model, estilo HF). indexOf(":")
    // solo mira el PRIMER ':' — no hay ':' en el modelId, así que el '/' nunca
    // se confunde con el separador provider:model.
    expect(parseChainString("deepinfra:Qwen/Qwen3-VL-30B-A3B-Instruct")).toEqual([
      { providerId: "deepinfra", modelId: "Qwen/Qwen3-VL-30B-A3B-Instruct" },
    ]);
  });

  it("parses a mixed chain with a deepinfra entry alongside others", () => {
    expect(parseChainString("deepinfra:Qwen/Qwen3-VL-30B-A3B-Instruct,anthropic:claude-haiku-4-5")).toEqual([
      { providerId: "deepinfra", modelId: "Qwen/Qwen3-VL-30B-A3B-Instruct" },
      { providerId: "anthropic", modelId: "claude-haiku-4-5" },
    ]);
  });
});

describe("loadModelsConfig — fail-loud invariant (§1.2)", () => {
  it("THROWS with the offending (provider, model) pair when a task references an unregistered model", () => {
    expect(() =>
      loadModelsConfig({
        raw: { tutor: "acme-labs:made-up-model-9000" },
        environment: "dev",
      }),
    ).toThrow(ModelsConfigError);

    expect(() =>
      loadModelsConfig({
        raw: { tutor: "acme-labs:made-up-model-9000" },
        environment: "dev",
      }),
    ).toThrow(/acme-labs/);

    expect(() =>
      loadModelsConfig({
        raw: { tutor: "acme-labs:made-up-model-9000" },
        environment: "dev",
      }),
    ).toThrow(/made-up-model-9000/);
  });

  it("throws for an unregistered model given as an already-parsed ModelRef[] too", () => {
    expect(() =>
      loadModelsConfig({
        raw: { assessor: [{ providerId: "openrouter", modelId: "not-in-registry" }] },
        environment: "dev",
      }),
    ).toThrow(/openrouter.*not-in-registry|not-in-registry.*openrouter/s);
  });

  it("mentions the task name in the error so a founder knows which env var to fix", () => {
    expect(() =>
      loadModelsConfig({
        raw: { judge: "nope:nope" },
        environment: "dev",
      }),
    ).toThrow(/"judge"/);
  });
});

describe("loadModelsConfig — floor / empty / malformed config (§1.3)", () => {
  it("falls back to the hardcoded floor for every FLOORED task when raw is empty", () => {
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    for (const task of ["tutor", "judge", "ingest", "safety"] as const) {
      expect(resolveChain(config, task)).toEqual([DEFAULT_FLOOR[task]]);
    }
    // CONTRATO CAMBIADO 2026-08-11 (migración DeepInfra): `assessor` dejó de
    // recibir piso, como ya hacían `temario-builder` y `mastery-assessor`.
    // Sin cadena configurada la resolución queda VACÍA y la llamada falla
    // RUIDOSO, en vez de caer en silencio a Sonnet. Es deliberado: la
    // política de privacidad v3 declara a DeepInfra como único proveedor de
    // IA, así que un piso Anthropic invisible volvería falso un documento
    // publicado. Olvidar `BUXO_ASSESSOR_CHAIN` ahora se nota; antes se pagaba.
    expect(resolveChain(config, "assessor")).toEqual([]);
    expect(resolveChain(config, "guided-items")).toEqual([]);
  });

  it("does not serve guided-items from an unvalidated floor; closed beta needs an explicit pending-gate allow", () => {
    const blocked = loadModelsConfig({
      raw: { guidedItems: "deepinfra:deepseek-ai/DeepSeek-V4-Flash-0731" },
      environment: "prod",
    });
    expect(resolveChain(blocked, "guided-items")).toEqual([]);
    expect(resolveChain(loadModelsConfig({ raw: {}, environment: "prod" }), "guided-items")).toEqual([]);

    const allowed = loadModelsConfig({
      raw: { guidedItems: "deepinfra:deepseek-ai/DeepSeek-V4-Flash-0731" },
      environment: "prod",
      guidedItemsAllowPendingGate: true,
    });
    expect(resolveChain(allowed, "guided-items")).toEqual([
      { providerId: "deepinfra", modelId: "deepseek-ai/DeepSeek-V4-Flash-0731" },
    ]);
    expect(resolveChain(allowed, "guided-items").some((ref) => ref.providerId === "anthropic")).toBe(false);
  });

  it("falls back to the floor when a chain string is malformed, without throwing", () => {
    const config = loadModelsConfig({ raw: { tutor: "not-a-valid-chain-string" }, environment: "dev" });
    expect(resolveChain(config, "tutor")).toEqual([DEFAULT_FLOOR.tutor]);
  });

  it("always appends the floor as the direct-route fallback even when the configured chain doesn't include it", () => {
    // Uses only `validated` registry models so this exercises pure
    // floor-append behavior decoupled from §1.4 gate filtering (gate
    // enforcement itself — which applies to EVERY TaskKind, including judge
    // — is covered separately below, "O-14 gate enforcement").
    const config = loadModelsConfig({
      raw: { judge: "anthropic:claude-haiku-4-5" },
      environment: "dev",
    });
    const chain = resolveChain(config, "judge");
    expect(chain[chain.length - 1]).toEqual(DEFAULT_FLOOR.judge);
    expect(chain).toEqual([
      { providerId: "anthropic", modelId: "claude-haiku-4-5" },
      { providerId: "anthropic", modelId: "claude-sonnet-5" },
    ]);
  });

  it("NUNCA appendea el piso Anthropic al assessor de banda ni al de mastery (migración DeepInfra: la política v3 declara a DeepInfra como ÚNICO proveedor de IA)", () => {
    // Guardia de la directiva "Anthropic sale por completo de la ruta del
    // estudiante". Con el piso puesto, un fallo de DeepSeek caía a Sonnet EN
    // SILENCIO y volvía falso un documento publicado (`legal/documents.ts`),
    // el mismo error que ya hubo que corregir con el judge. Este test falla
    // contra el `skipFloor` que no incluía "assessor" — verificado por
    // mutación al escribirlo.
    const config = loadModelsConfig({
      raw: {
        assessor: "deepinfra:deepseek-ai/DeepSeek-V4-Flash-0731",
        masteryAssessor: "deepinfra:Qwen/Qwen3.6-35B-A3B",
      },
      environment: "prod",
    });
    for (const task of ["assessor", "mastery-assessor"] as const) {
      const chain = resolveChain(config, task);
      expect(chain.length).toBeGreaterThan(0);
      expect(chain.some((ref) => ref.providerId === "anthropic")).toBe(false);
    }
  });

  it("(tutor, gate-enforced) appends the floor AND drops a pending_gate candidate outside dev+flag in the same pass", () => {
    const config = loadModelsConfig({
      raw: { tutor: "openrouter:deepseek-v3.2,anthropic:claude-haiku-4-5" },
      environment: "dev",
      devAllowPendingGate: true,
    });
    const chain = resolveChain(config, "tutor");
    expect(chain).toEqual([
      { providerId: "openrouter", modelId: "deepseek-v3.2" },
      { providerId: "anthropic", modelId: "claude-haiku-4-5" },
      { providerId: "anthropic", modelId: "claude-sonnet-5" },
    ]);
  });

  it("does not duplicate the floor when the configured chain already ends with it", () => {
    const config = loadModelsConfig({
      raw: { judge: "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5" },
      environment: "dev",
    });
    expect(resolveChain(config, "judge")).toEqual([
      { providerId: "anthropic", modelId: "claude-haiku-4-5" },
      { providerId: "anthropic", modelId: "claude-sonnet-5" },
    ]);
  });
});

describe("loadModelsConfig — O-14 gate enforcement (pending_gate blocked for EVERY TaskKind — architect ruling 2026-07-14)", () => {
  it("drops a pending_gate candidate from the tutor chain in prod", () => {
    const config = loadModelsConfig({
      raw: { tutor: "openrouter:deepseek-v3.2,anthropic:claude-sonnet-5" },
      environment: "prod",
    });
    expect(resolveChain(config, "tutor")).toEqual([{ providerId: "anthropic", modelId: "claude-sonnet-5" }]);
  });

  it("drops a pending_gate candidate from the assessor chain in staging (only dev+flag is exempt)", () => {
    const config = loadModelsConfig({
      raw: { assessor: "openrouter:qwen2.5-72b-instruct,anthropic:claude-sonnet-5" },
      environment: "staging",
    });
    expect(resolveChain(config, "assessor")).toEqual([{ providerId: "anthropic", modelId: "claude-sonnet-5" }]);
  });

  it("drops a pending_gate candidate from the tutor chain in dev WITHOUT the explicit flag", () => {
    const config = loadModelsConfig({
      raw: { tutor: "openrouter:deepseek-v3.2,anthropic:claude-sonnet-5" },
      environment: "dev",
    });
    expect(resolveChain(config, "tutor")).toEqual([{ providerId: "anthropic", modelId: "claude-sonnet-5" }]);
  });

  it("KEEPS a pending_gate candidate in the tutor chain in dev WITH the explicit flag", () => {
    const config = loadModelsConfig({
      raw: { tutor: "openrouter:deepseek-v3.2,anthropic:claude-sonnet-5" },
      environment: "dev",
      devAllowPendingGate: true,
    });
    expect(resolveChain(config, "tutor")).toEqual([
      { providerId: "openrouter", modelId: "deepseek-v3.2" },
      { providerId: "anthropic", modelId: "claude-sonnet-5" },
    ]);
  });

  it("enforces the gate for judge too — every TaskKind is gate-enforced (architect ruling 2026-07-14)", () => {
    const config = loadModelsConfig({
      raw: { judge: "openrouter:deepseek-v3.2,anthropic:claude-sonnet-5" },
      environment: "prod",
    });
    // deepseek-v3.2 is pending_gate and gets dropped; claude-sonnet-5 is
    // both validated AND the judge floor, so the chain collapses to it.
    expect(resolveChain(config, "judge")).toEqual([{ providerId: "anthropic", modelId: "claude-sonnet-5" }]);
  });

  it("enforces the gate for ingest/safety too — every TaskKind is gate-enforced (architect ruling 2026-07-14)", () => {
    const config = loadModelsConfig({
      raw: {
        ingest: "openrouter:qwen2.5-72b-instruct,anthropic:claude-haiku-4-5",
        safety: "openrouter:qwen2.5-72b-instruct,anthropic:claude-haiku-4-5",
      },
      environment: "prod",
    });
    // qwen2.5-72b-instruct is pending_gate and gets dropped from both
    // chains; claude-haiku-4-5 is DEFAULT_FLOOR for both ingest and safety.
    expect(resolveChain(config, "ingest")).toEqual([DEFAULT_FLOOR.ingest]);
    expect(resolveChain(config, "safety")).toEqual([DEFAULT_FLOOR.safety]);
  });

  it("SERVES the deepinfra Qwen3-VL candidate in the ingest chain in prod (gate O-14 aprobado 2026-08-02)", () => {
    // Antes de aprobar el gate esta misma prueba exigía lo contrario (que la
    // candidata se cayera de la cadena). El gate corrió y pasó
    // (docs/plan-modal-rag/06-gate-o14-ingesta.md: recall ES 0.982,
    // precisión ES 1.000), así que ahora SÍ debe servirse en producción.
    const config = loadModelsConfig({
      raw: { ingest: "deepinfra:Qwen/Qwen3-VL-30B-A3B-Instruct" },
      environment: "prod",
    });
    expect(resolveChain(config, "ingest")).toEqual([
      { providerId: "deepinfra", modelId: "Qwen/Qwen3-VL-30B-A3B-Instruct" },
      DEFAULT_FLOOR.ingest,
    ]);
  });

  it("SIGUE bloqueando en prod a una candidata que NO pasó el gate (la guardia no se debilitó)", () => {
    // Contrapeso del cambio de arriba: aprobar una fila no puede haber
    // aflojado la regla para el resto.
    const config = loadModelsConfig({
      raw: { ingest: "openrouter:qwen2.5-72b-instruct" },
      environment: "prod",
    });
    expect(resolveChain(config, "ingest")).toEqual([DEFAULT_FLOOR.ingest]);
  });

  it("KEEPS the deepinfra Qwen3-VL candidate in the ingest chain in dev WITH the explicit flag", () => {
    const config = loadModelsConfig({
      raw: { ingest: "deepinfra:Qwen/Qwen3-VL-30B-A3B-Instruct" },
      environment: "dev",
      devAllowPendingGate: true,
    });
    expect(resolveChain(config, "ingest")).toEqual([
      { providerId: "deepinfra", modelId: "Qwen/Qwen3-VL-30B-A3B-Instruct" },
      DEFAULT_FLOOR.ingest,
    ]);
  });

  it("throws if devAllowPendingGate is set outside the dev environment (the flag must never leak to staging/prod)", () => {
    expect(() => loadModelsConfig({ raw: {}, environment: "staging", devAllowPendingGate: true })).toThrow(
      ModelsConfigError,
    );
    expect(() => loadModelsConfig({ raw: {}, environment: "prod", devAllowPendingGate: true })).toThrow(/dev/);
  });
});

describe("loadModelsConfig — tutorFailoverFloor (BE2 decision, 2026-07-18)", () => {
  it("with tutorFailoverFloor='none', the tutor chain does NOT contain the Sonnet floor", () => {
    const config = loadModelsConfig({
      raw: { tutor: "ollama:gemma4:31b-cloud" },
      environment: "prod",
      tutorFailoverFloor: "none",
    });
    const chain = resolveChain(config, "tutor");
    expect(chain).toEqual([{ providerId: "ollama", modelId: "gemma4:31b-cloud" }]);
    // Sonnet floor is NOT present
    expect(chain.find((ref) => ref.providerId === "anthropic" && ref.modelId === "claude-sonnet-5")).toBeUndefined();
  });

  it("with tutorFailoverFloor='none', the assessor chain STILL has the Sonnet floor (only tutor affected)", () => {
    const config = loadModelsConfig({
      raw: { assessor: "anthropic:claude-sonnet-5" },
      environment: "prod",
      tutorFailoverFloor: "none",
    });
    const chain = resolveChain(config, "assessor");
    expect(chain).toEqual([{ providerId: "anthropic", modelId: "claude-sonnet-5" }]);
  });

  it("with tutorFailoverFloor='none' and empty tutor chain, returns empty chain (fail-loud at call time)", () => {
    const config = loadModelsConfig({
      raw: {},
      environment: "prod",
      tutorFailoverFloor: "none",
    });
    const chain = resolveChain(config, "tutor");
    expect(chain).toEqual([]);
  });

  it("with tutorFailoverFloor='sonnet' (default), the tutor chain still has the Sonnet floor (preserves current behavior)", () => {
    const config = loadModelsConfig({
      raw: { tutor: "ollama:gemma4:31b-cloud" },
      environment: "prod",
      tutorFailoverFloor: "sonnet",
    });
    const chain = resolveChain(config, "tutor");
    expect(chain[chain.length - 1]).toEqual(DEFAULT_FLOOR.tutor);
  });

  it("with tutorFailoverFloor='none', a pending_gate candidate is dropped AND no floor is appended (empty chain)", () => {
    const config = loadModelsConfig({
      raw: { tutor: "openrouter:deepseek-v3.2" },
      environment: "prod",
      tutorFailoverFloor: "none",
    });
    const chain = resolveChain(config, "tutor");
    // deepseek-v3.2 is pending_gate -> dropped; no floor appended -> empty
    expect(chain).toEqual([]);
  });
});

describe("loadModelsConfig — temario-builder (P2 FIX1, 2026-07-21 post-real-run REVIEW)", () => {
  it("NEVER appends the Sonnet floor to temario-builder — ni al assessor de banda ni al de mastery (2026-08-11)", () => {
    const config = loadModelsConfig({ raw: {}, environment: "dev" });
    for (const task of ["tutor", "judge", "ingest", "safety"] as const) {
      expect(resolveChain(config, task)).toEqual([DEFAULT_FLOOR[task]]);
    }
    // Los sin-piso: cadena configurada vacía -> resolución VACÍA (fallo
    // ruidoso en la llamada), NO `[DEFAULT_FLOOR[task]]`. `temario-builder`
    // desde P2 FIX1; `assessor` y `mastery-assessor` desde la migración
    // DeepInfra, para que ningún fallo caiga a Anthropic en silencio.
    for (const task of ["temario-builder", "assessor", "mastery-assessor", "guided-items"] as const) {
      expect(resolveChain(config, task)).toEqual([]);
    }
  });

  it("resolves to exactly the single configured model, with no floor appended", () => {
    const config = loadModelsConfig({ raw: { temarioBuilder: "anthropic:claude-haiku-4-5" }, environment: "dev" });
    expect(resolveChain(config, "temario-builder")).toEqual([{ providerId: "anthropic", modelId: "claude-haiku-4-5" }]);
  });

  it("throws ModelsConfigError for a multi-model temario-builder chain — cross-model failover mid-construction is unsupported", () => {
    expect(() =>
      loadModelsConfig({
        raw: { temarioBuilder: "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5" },
        environment: "dev",
      }),
    ).toThrow(ModelsConfigError);
    expect(() =>
      loadModelsConfig({
        raw: { temarioBuilder: "anthropic:claude-haiku-4-5,anthropic:claude-sonnet-5" },
        environment: "dev",
      }),
    ).toThrow(/temario-builder.*multi-model chain/i);
  });

  it("does not throw for a single-entry array-form chain (already-parsed ModelRef[])", () => {
    const config = loadModelsConfig({
      raw: { temarioBuilder: [{ providerId: "anthropic", modelId: "claude-sonnet-5" }] },
      environment: "dev",
    });
    expect(resolveChain(config, "temario-builder")).toEqual([{ providerId: "anthropic", modelId: "claude-sonnet-5" }]);
  });

  it("throws for a multi-entry array-form chain too (guard isn't string-parsing-specific)", () => {
    expect(() =>
      loadModelsConfig({
        raw: {
          temarioBuilder: [
            { providerId: "anthropic", modelId: "claude-haiku-4-5" },
            { providerId: "anthropic", modelId: "claude-sonnet-5" },
          ],
        },
        environment: "dev",
      }),
    ).toThrow(/temario-builder.*multi-model chain/i);
  });
});

describe("RawModelsConfigSchema", () => {
  it("rejects unknown top-level keys (strict schema catches env var typos like 'tutr')", () => {
    expect(() => loadModelsConfig({ raw: { tutr: "anthropic:claude-sonnet-5" }, environment: "dev" })).toThrow(
      ModelsConfigError,
    );
  });

  it("accepts a fully-formed raw config directly via the exported schema", () => {
    const result = RawModelsConfigSchema.safeParse({
      tutor: "anthropic:claude-sonnet-5",
      assessor: [{ providerId: "anthropic", modelId: "claude-sonnet-5" }],
    });
    expect(result.success).toBe(true);
  });
});
