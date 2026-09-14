import { describe, expect, it } from "vitest";
import { formatModelRef, modelRefEquals, modelRefKey, ModelRefSchema, TASK_KINDS, ENVIRONMENTS } from "../task";

describe("task vocabulary", () => {
  it("formats a ModelRef as provider:model", () => {
    expect(formatModelRef({ providerId: "anthropic", modelId: "claude-sonnet-5" })).toBe("anthropic:claude-sonnet-5");
  });

  it("modelRefKey matches formatModelRef (same join convention)", () => {
    const ref = { providerId: "openrouter", modelId: "deepseek-v3.2" };
    expect(modelRefKey(ref.providerId, ref.modelId)).toBe(formatModelRef(ref));
  });

  it("modelRefEquals compares structurally", () => {
    expect(modelRefEquals({ providerId: "a", modelId: "b" }, { providerId: "a", modelId: "b" })).toBe(true);
    expect(modelRefEquals({ providerId: "a", modelId: "b" }, { providerId: "a", modelId: "c" })).toBe(false);
  });

  it("ModelRefSchema rejects empty providerId/modelId", () => {
    expect(ModelRefSchema.safeParse({ providerId: "", modelId: "x" }).success).toBe(false);
    expect(ModelRefSchema.safeParse({ providerId: "x", modelId: "" }).success).toBe(false);
    expect(ModelRefSchema.safeParse({ providerId: "x", modelId: "y" }).success).toBe(true);
  });

  it("has the model task kinds including guided structured generation", () => {
    expect(TASK_KINDS).toEqual(["tutor", "assessor", "judge", "ingest", "safety", "temario-builder", "mastery-assessor", "guided-items"]);
  });

  it("has the three §6.5 environments", () => {
    expect(ENVIRONMENTS).toEqual(["dev", "staging", "prod"]);
  });
});
