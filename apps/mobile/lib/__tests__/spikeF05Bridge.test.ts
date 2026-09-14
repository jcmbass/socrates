import { describe, expect, it } from "vitest";
import {
  chunkForLogcat,
  isHostToWebMessage,
  isWebToHostMessage,
  LOGCAT_MARKER,
  parseWebToHostMessage,
} from "../spikeF05Bridge";

describe("spikeF05Bridge — SPIKE F0.5 throwaway bridge contract", () => {
  describe("isHostToWebMessage", () => {
    it("accepts a well-formed run message", () => {
      expect(isHostToWebMessage({ type: "run", fileName: "guia1.pdf", pdfBase64: "AAAA" })).toBe(true);
    });

    it("rejects missing/empty pdfBase64", () => {
      expect(isHostToWebMessage({ type: "run", fileName: "guia1.pdf", pdfBase64: "" })).toBe(false);
      expect(isHostToWebMessage({ type: "run", fileName: "guia1.pdf" })).toBe(false);
    });

    it("rejects non-run types and non-objects", () => {
      expect(isHostToWebMessage({ type: "other" })).toBe(false);
      expect(isHostToWebMessage(null)).toBe(false);
      expect(isHostToWebMessage("run")).toBe(false);
      expect(isHostToWebMessage(42)).toBe(false);
    });
  });

  describe("isWebToHostMessage", () => {
    it("accepts a log message", () => {
      expect(isWebToHostMessage({ type: "log", level: "warn", message: "hi", ts: 1 })).toBe(true);
    });

    it("rejects a log message with an invalid level", () => {
      expect(isWebToHostMessage({ type: "log", level: "trace", message: "hi", ts: 1 })).toBe(false);
    });

    it("accepts a progress message", () => {
      expect(isWebToHostMessage({ type: "progress", page: 1, total: 3, routeKind: "local-text" })).toBe(
        true,
      );
    });

    it("rejects a progress message with wrong field types", () => {
      expect(isWebToHostMessage({ type: "progress", page: "1", total: 3, routeKind: "local-text" })).toBe(
        false,
      );
    });

    it("accepts a result message with a minimal result shape", () => {
      expect(
        isWebToHostMessage({
          type: "result",
          result: { fileName: "guia1.pdf", totalElapsedMs: 1200, routes: [], report: [] },
        }),
      ).toBe(true);
    });

    it("rejects a result message missing fileName", () => {
      expect(isWebToHostMessage({ type: "result", result: { totalElapsedMs: 1200 } })).toBe(false);
    });

    it("accepts a fatal message", () => {
      expect(isWebToHostMessage({ type: "fatal", message: "boom" })).toBe(true);
    });

    it("rejects an unknown type", () => {
      expect(isWebToHostMessage({ type: "ping" })).toBe(false);
    });
  });

  describe("parseWebToHostMessage", () => {
    it("parses and validates a well-formed JSON string", () => {
      const raw = JSON.stringify({ type: "fatal", message: "boom" });
      expect(parseWebToHostMessage(raw)).toEqual({ type: "fatal", message: "boom" });
    });

    it("degrades to null on malformed JSON instead of throwing", () => {
      expect(parseWebToHostMessage("{not json")).toBeNull();
    });

    it("degrades to null on well-formed JSON that doesn't match any known shape", () => {
      expect(parseWebToHostMessage(JSON.stringify({ type: "mystery" }))).toBeNull();
    });
  });

  describe("chunkForLogcat", () => {
    it("returns a single chunk for a short payload", () => {
      const chunks = chunkForLogcat("hello world");
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(`${LOGCAT_MARKER} 1/1 hello world`);
    });

    it("splits a long payload into multiple ordered, reassemblable chunks", () => {
      const payload = "x".repeat(7000);
      const chunks = chunkForLogcat(payload);
      expect(chunks.length).toBeGreaterThan(1);

      // Reassemble exactly as the offline logcat-parsing script would: strip
      // the "MARKER i/total " prefix from each chunk, in order, and concat.
      const reassembled = chunks
        .map((line) => line.replace(new RegExp(`^${LOGCAT_MARKER} \\d+/\\d+ `), ""))
        .join("");
      expect(reassembled).toBe(payload);
    });

    it("every chunk is at or under the logcat-safe size budget (plus prefix)", () => {
      const payload = "y".repeat(12345);
      const chunks = chunkForLogcat(payload);
      for (const c of chunks) {
        expect(c.length).toBeLessThan(3100);
      }
    });
  });
});
