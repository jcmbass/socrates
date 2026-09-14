import { describe, expect, it } from "vitest";
import {
  chunkFuente,
  chunkFuentes,
  DEFAULT_CHUNK_OVERLAP_RATIO,
  DEFAULT_CHUNK_TARGET_TOKENS,
} from "../../src/materials/chunk-fuentes";
import { estimateTokens } from "@buxo/core/truncate";

describe("chunkFuente (plan-modal-rag F2)", () => {
  it("returns empty for blank text", () => {
    expect(
      chunkFuente({
        subjectId: "s1",
        fuenteId: "f1",
        fuenteName: "Guía",
        text: "  \n  ",
      }),
    ).toEqual([]);
  });

  it("prefixes every chunk with ### fuenteName", () => {
    const chunks = chunkFuente({
      subjectId: "s1",
      fuenteId: "f1",
      fuenteName: "Guía de Química.pdf",
      text: "La estequiometría relaciona moles y masa.\n\nEl mol es 6.022e23 entidades.",
    });
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.text.startsWith("### Guía de Química.pdf\n\n")).toBe(true);
      expect(c.fuenteName).toBe("Guía de Química.pdf");
      expect(c.subjectId).toBe("s1");
      expect(c.fuenteId).toBe("f1");
    }
  });

  it("respects configurable targetTokens", () => {
    const paragraph = "palabra ".repeat(200).trim(); // ~400 tokens worth of chars/4
    const text = Array.from({ length: 6 }, (_, i) => `Bloque ${i}. ${paragraph}`).join("\n\n");
    const small = chunkFuente(
      { subjectId: "s", fuenteId: "f", fuenteName: "Doc", text },
      { targetTokens: 200, overlapRatio: 0 },
    );
    const large = chunkFuente(
      { subjectId: "s", fuenteId: "f", fuenteName: "Doc", text },
      { targetTokens: 2000, overlapRatio: 0 },
    );
    expect(small.length).toBeGreaterThan(large.length);
    expect(DEFAULT_CHUNK_TARGET_TOKENS).toBe(600);
    expect(DEFAULT_CHUNK_OVERLAP_RATIO).toBe(0.15);
  });

  it("assigns contiguous chunkIndex from 0", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Párrafo número ${i}: ${"x".repeat(400)}`).join(
      "\n\n",
    );
    const chunks = chunkFuente(
      { subjectId: "s", fuenteId: "f", fuenteName: "N", text },
      { targetTokens: 150, overlapRatio: 0.1 },
    );
    expect(chunks.map((c) => c.chunkIndex)).toEqual(
      Array.from({ length: chunks.length }, (_, i) => i),
    );
    for (const c of chunks) {
      expect(c.tokenEstimate).toBe(estimateTokens(c.text));
    }
  });

  it("chunkFuentes concatenates per-fuente indices independently", () => {
    const out = chunkFuentes([
      { subjectId: "s", fuenteId: "a", fuenteName: "A", text: "uno" },
      { subjectId: "s", fuenteId: "b", fuenteName: "B", text: "dos" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.chunkIndex).toBe(0);
    expect(out[1]!.chunkIndex).toBe(0);
    expect(out[0]!.fuenteId).toBe("a");
    expect(out[1]!.fuenteId).toBe("b");
  });
});
