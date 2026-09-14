/**
 * clientUploadId — material ingest idempotency (mirrors clientMessageId).
 */
import { describe, expect, it } from "vitest";
import { createClientUploadId, resolveClientUploadId } from "../clientUploadId";

describe("createClientUploadId", () => {
  it("returns a cu- prefixed opaque id", () => {
    const id = createClientUploadId(1_700_000_000_000);
    expect(id.startsWith("cu-")).toBe(true);
    expect(id.length).toBeGreaterThan(6);
  });

  it("is unique across calls", () => {
    const a = createClientUploadId();
    const b = createClientUploadId();
    expect(a).not.toBe(b);
  });
});

describe("resolveClientUploadId", () => {
  it("reuses a pending id (retry must not mint a new key)", () => {
    expect(resolveClientUploadId("cu-pending-1")).toBe("cu-pending-1");
  });

  it("mints a fresh id when nothing is pending", () => {
    const id = resolveClientUploadId(null);
    expect(id.startsWith("cu-")).toBe(true);
  });
});
