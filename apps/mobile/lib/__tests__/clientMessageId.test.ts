/**
 * Client message id stability across retries (beta-real 10).
 */
import { describe, expect, it } from "vitest";
import { createClientMessageId, resolveClientMessageId } from "../clientMessageId";
import { shouldCheckIfTurnLanded } from "../turnReconcile";

describe("resolveClientMessageId — retry reuses the same id", () => {
  it("creates a new id when nothing is pending", () => {
    const id = resolveClientMessageId(null);
    expect(id.startsWith("cm-")).toBe(true);
    expect(id.length).toBeGreaterThan(4);
  });

  it("reuses the pending id on retry (the central invariant)", () => {
    const first = resolveClientMessageId(null);
    const retry = resolveClientMessageId(first);
    expect(retry).toBe(first);
  });

  it("createClientMessageId is opaque and non-empty", () => {
    expect(createClientMessageId(1_700_000_000_000).length).toBeGreaterThan(4);
  });
});

describe("shouldCheckIfTurnLanded — duplicate_turn reconciles, not red error", () => {
  it("includes duplicate_turn alongside transport failures", () => {
    expect(shouldCheckIfTurnLanded("duplicate_turn")).toBe(true);
    expect(shouldCheckIfTurnLanded("network_error")).toBe(true);
    expect(shouldCheckIfTurnLanded("quota_exceeded")).toBe(false);
  });
});
