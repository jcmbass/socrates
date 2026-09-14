import { describe, expect, it } from "vitest";
import { ModelCapabilitiesSchema, estimateCostUsd } from "../capabilities";

const validRow = {
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
  pricePerMTokOut: 10,
  costModel: "per-token" as const,
  fixedCostRef: null,
  notes: "test row",
  verifiedAt: "2026-07-11",
  verifiedBy: "manual_docs_review" as const,
  gateStatus: "validated" as const,
};

describe("ModelCapabilitiesSchema", () => {
  it("accepts a well-formed row", () => {
    expect(ModelCapabilitiesSchema.safeParse(validRow).success).toBe(true);
  });

  it("accepts null structuredOutputForce/prices/context limits (never fabricated)", () => {
    const row = { ...validRow, structuredOutputForce: null, pricePerMTokIn: null, pricePerMTokOut: null };
    expect(ModelCapabilitiesSchema.safeParse(row).success).toBe(true);
  });

  it("rejects an unknown structuredOutputSupport value", () => {
    const row = { ...validRow, structuredOutputSupport: "definitely_works_trust_me" };
    expect(ModelCapabilitiesSchema.safeParse(row).success).toBe(false);
  });

  it("rejects an unknown gateStatus value", () => {
    const row = { ...validRow, gateStatus: "probably_fine" };
    expect(ModelCapabilitiesSchema.safeParse(row).success).toBe(false);
  });

  it("rejects a negative price", () => {
    const row = { ...validRow, pricePerMTokIn: -1 };
    expect(ModelCapabilitiesSchema.safeParse(row).success).toBe(false);
  });

  it("rejects an empty providerId/modelId", () => {
    expect(ModelCapabilitiesSchema.safeParse({ ...validRow, providerId: "" }).success).toBe(false);
    expect(ModelCapabilitiesSchema.safeParse({ ...validRow, modelId: "" }).success).toBe(false);
  });
});

describe("estimateCostUsd", () => {
  it("returns null when pricePerMTokIn is null (per-token, unknown price)", () => {
    expect(estimateCostUsd({ pricePerMTokIn: null, pricePerMTokOut: 10, costModel: "per-token" }, 1000, 500)).toBeNull();
  });

  it("returns null when pricePerMTokOut is null (per-token, unknown price)", () => {
    expect(estimateCostUsd({ pricePerMTokIn: 2, pricePerMTokOut: null, costModel: "per-token" }, 1000, 500)).toBeNull();
  });

  it("computes the same result as apps/harness/lib/ingest/pricing.ts's estimateCostUsd for claude-sonnet-5-shaped pricing", () => {
    // (2000 * 2 + 1000 * 10) / 1e6 = 0.014 — mirrors pricing.test.ts's "computes sonnet cost correctly".
    const cost = estimateCostUsd({ pricePerMTokIn: 2, pricePerMTokOut: 10, costModel: "per-token" }, 2000, 1000);
    expect(cost).toBeCloseTo(0.014, 6);
  });

  it("returns 0 for zero tokens with known pricing (never confuses '0 cost' with 'unknown cost')", () => {
    expect(estimateCostUsd({ pricePerMTokIn: 2, pricePerMTokOut: 10, costModel: "per-token" }, 0, 0)).toBe(0);
  });

  // --- F3 G5: self-hosted cost model ---

  it("returns 0 for self-hosted regardless of token count (zero marginal cost by design)", () => {
    expect(estimateCostUsd({ pricePerMTokIn: null, pricePerMTokOut: null, costModel: "self-hosted" }, 10000, 5000)).toBe(0);
  });

  it("returns 0 for self-hosted with zero tokens", () => {
    expect(estimateCostUsd({ pricePerMTokIn: null, pricePerMTokOut: null, costModel: "self-hosted" }, 0, 0)).toBe(0);
  });

  it("distinguishes self-hosted 0 from per-token null (critical distinction)", () => {
    const selfHosted = estimateCostUsd({ pricePerMTokIn: null, pricePerMTokOut: null, costModel: "self-hosted" }, 1000, 500);
    const perTokenUnknown = estimateCostUsd({ pricePerMTokIn: null, pricePerMTokOut: null, costModel: "per-token" }, 1000, 500);
    expect(selfHosted).toBe(0);
    expect(perTokenUnknown).toBeNull();
    // 0 !== null — downstream consumers MUST distinguish these two cases
    expect(selfHosted).not.toBe(perTokenUnknown);
  });
});
