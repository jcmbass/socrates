import { describe, expect, it } from "vitest";
import {
  FuenteSchema,
  deserializeFuente,
  emptyFuente,
  parseFuente,
  serializeFuente,
  type Fuente,
} from "../fuente";

const TS = "2026-07-21T10:00:00.000Z";
const NOW = new Date(TS);

function makeFuente(overrides: Partial<Fuente> = {}): Fuente {
  return {
    id: "fuente-1",
    subjectId: "subject-1",
    userId: "user-1",
    name: "Guía de Geometría.pdf",
    kind: "pdf",
    text: "Los triángulos...",
    tokens: 1234,
    createdAt: TS,
    schemaVersion: 1,
    ...overrides,
  };
}

describe("FuenteSchema", () => {
  it("accepts a well-formed pdf source", () => {
    expect(FuenteSchema.safeParse(makeFuente()).success).toBe(true);
  });

  it("accepts an image source", () => {
    expect(FuenteSchema.safeParse(makeFuente({ kind: "image" })).success).toBe(true);
  });

  it("accepts missing tokens", () => {
    expect(FuenteSchema.safeParse(makeFuente({ tokens: undefined })).success).toBe(true);
  });

  it("rejects an invalid kind", () => {
    expect(FuenteSchema.safeParse(makeFuente({ kind: "video" as never })).success).toBe(false);
  });

  it("rejects negative tokens", () => {
    expect(FuenteSchema.safeParse(makeFuente({ tokens: -1 })).success).toBe(false);
  });
});

describe("emptyFuente factory", () => {
  it("creates a text-only source with required fields", () => {
    const fuente = emptyFuente({
      subjectId: "s1",
      userId: "u1",
      name: "Foto.jpg",
      kind: "image",
      text: "texto extraído",
      now: NOW,
    });
    expect(fuente.subjectId).toBe("s1");
    expect(fuente.userId).toBe("u1");
    expect(fuente.kind).toBe("image");
    expect(fuente.text).toBe("texto extraído");
    expect(fuente.createdAt).toBe(TS);
    expect(fuente.schemaVersion).toBe(1);
  });
});

describe("Serialization round-trip", () => {
  it("round-trips a full Fuente", () => {
    const fuente = makeFuente();
    const restored = parseFuente(JSON.parse(serializeFuente(fuente)));
    expect(restored).toEqual(fuente);
  });

  it("round-trips a Fuente without optional tokens", () => {
    const fuente = makeFuente({ tokens: undefined });
    const restored = parseFuente(JSON.parse(serializeFuente(fuente)));
    expect(restored).toEqual(fuente);
  });

  it("deserializeFuente rejects invalid JSON", () => {
    expect(() => deserializeFuente("not-json")).toThrow();
  });
});
