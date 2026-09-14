import { describe, expect, it } from "vitest";
import {
  isHostToWebMessage,
  isWebToHostMessage,
  parseWebToHostMessage,
  type IngestResult,
} from "../materialIngestBridge";

function validResult(overrides: Partial<IngestResult> = {}): IngestResult {
  return {
    fileName: "guia.pdf",
    totalPages: 2,
    manifest: [
      { pageNumber: 1, claimedTier: "local", localText: "texto local" },
      { pageNumber: 2, claimedTier: "cloud", localText: null },
    ],
    cloudPages: [{ pageNumber: 2, base64: "AAAA" }],
    ...overrides,
  };
}

describe("materialIngestBridge — F2 WQ2 Part 2 production bridge contract", () => {
  describe("isHostToWebMessage", () => {
    it("accepts a well-formed ingest message", () => {
      expect(isHostToWebMessage({ type: "ingest", requestId: "r1", fileName: "guia.pdf", pdfBase64: "AAAA" })).toBe(true);
    });

    it("rejects missing/empty pdfBase64", () => {
      expect(isHostToWebMessage({ type: "ingest", requestId: "r1", fileName: "guia.pdf", pdfBase64: "" })).toBe(false);
      expect(isHostToWebMessage({ type: "ingest", requestId: "r1", fileName: "guia.pdf" })).toBe(false);
    });

    it("rejects missing requestId, wrong types, and non-objects", () => {
      expect(isHostToWebMessage({ type: "ingest", fileName: "guia.pdf", pdfBase64: "AAAA" })).toBe(false);
      expect(isHostToWebMessage({ type: "other" })).toBe(false);
      expect(isHostToWebMessage(null)).toBe(false);
      expect(isHostToWebMessage(42)).toBe(false);
    });
  });

  describe("isWebToHostMessage", () => {
    it("accepts a progress message", () => {
      expect(isWebToHostMessage({ type: "progress", requestId: "r1", page: 1, total: 2, routeKind: "local-text" })).toBe(true);
    });

    it("rejects a progress message with wrong field types or missing requestId", () => {
      expect(isWebToHostMessage({ type: "progress", requestId: "r1", page: "1", total: 2, routeKind: "local-text" })).toBe(false);
      expect(isWebToHostMessage({ type: "progress", page: 1, total: 2, routeKind: "local-text" })).toBe(false);
    });

    it("accepts a well-formed result message", () => {
      expect(isWebToHostMessage({ type: "result", requestId: "r1", result: validResult() })).toBe(true);
    });

    it("rejects a result whose manifest entry has a bad claimedTier or missing localText field shape", () => {
      const bad = validResult({ manifest: [{ pageNumber: 1, claimedTier: "remote", localText: null } as never] });
      expect(isWebToHostMessage({ type: "result", requestId: "r1", result: bad })).toBe(false);
    });

    it("rejects a result whose cloudPages entry is missing base64", () => {
      const bad = validResult({ cloudPages: [{ pageNumber: 2 } as never] });
      expect(isWebToHostMessage({ type: "result", requestId: "r1", result: bad })).toBe(false);
    });

    it("accepts a fatal message", () => {
      expect(isWebToHostMessage({ type: "fatal", requestId: "r1", message: "boom" })).toBe(true);
    });

    it("rejects unknown types and non-objects", () => {
      expect(isWebToHostMessage({ type: "log", requestId: "r1" })).toBe(false);
      expect(isWebToHostMessage(null)).toBe(false);
      expect(isWebToHostMessage("progress")).toBe(false);
    });
  });

  describe("parseWebToHostMessage", () => {
    it("parses a valid JSON-encoded result message", () => {
      const msg = { type: "result" as const, requestId: "r1", result: validResult() };
      expect(parseWebToHostMessage(JSON.stringify(msg))).toEqual(msg);
    });

    it("returns null for malformed JSON", () => {
      expect(parseWebToHostMessage("{not json")).toBeNull();
    });

    it("returns null for well-formed JSON that doesn't match the shape", () => {
      expect(parseWebToHostMessage(JSON.stringify({ type: "unknown" }))).toBeNull();
    });
  });
});
