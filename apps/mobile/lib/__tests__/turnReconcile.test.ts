/**
 * Regresión: un turno que se pasó de tiempo en el cliente pero llegó al
 * servidor se reenviaba, duplicando el mensaje en la transcripción.
 * Ver `lib/turnReconcile.ts`.
 */
import { describe, expect, it } from "vitest";
import { findLandedTurn, shouldCheckIfTurnLanded } from "../turnReconcile";

const turn = (studentMessage: string, tutorReply: string) => ({ studentMessage, tutorReply });

describe("findLandedTurn", () => {
  it("encuentra el turno que sí llegó y fue respondido", () => {
    const turns = [turn("hola", "¿qué querés estudiar?"), turn("no entiendo la herencia", "¿qué parte?")];
    expect(findLandedTurn(turns, "no entiendo la herencia")).toBe(turns[1]);
  });

  it("ignora diferencias de bordes (el servidor normaliza)", () => {
    const turns = [turn("no entiendo la herencia", "¿qué parte?")];
    expect(findLandedTurn(turns, "  no entiendo la herencia  ")).toBe(turns[0]);
  });

  it("devuelve el MÁS RECIENTE cuando el mensaje se repitió de verdad", () => {
    const turns = [turn("dale", "primera"), turn("dale", "segunda")];
    expect(findLandedTurn(turns, "dale")?.tutorReply).toBe("segunda");
  });

  it("no lo cuenta como llegado si el tutor no respondió", () => {
    expect(findLandedTurn([turn("hola", "")], "hola")).toBeNull();
    expect(findLandedTurn([turn("hola", "   ")], "hola")).toBeNull();
  });

  it("null cuando no está, y con transcripción vacía", () => {
    expect(findLandedTurn([turn("otra cosa", "r")], "hola")).toBeNull();
    expect(findLandedTurn([], "hola")).toBeNull();
  });

  it("null para un pendiente vacío — nunca adoptar un turno por coincidencia trivial", () => {
    expect(findLandedTurn([turn("", "r")], "   ")).toBeNull();
  });
});

describe("shouldCheckIfTurnLanded", () => {
  it("pregunta al servidor ante fallas de transporte", () => {
    expect(shouldCheckIfTurnLanded("network_error")).toBe(true);
    expect(shouldCheckIfTurnLanded("upstream_error")).toBe(true);
    expect(shouldCheckIfTurnLanded("internal_error")).toBe(true);
  });

  it("también reconcilia duplicate_turn (beta-real 10) — no es error rojo", () => {
    expect(shouldCheckIfTurnLanded("duplicate_turn")).toBe(true);
  });

  it("no pregunta ante rechazos explícitos: no dejaron turno a medias", () => {
    expect(shouldCheckIfTurnLanded("quota_exceeded")).toBe(false);
    expect(shouldCheckIfTurnLanded("safety_blocked")).toBe(false);
    expect(shouldCheckIfTurnLanded("conflict")).toBe(false);
    expect(shouldCheckIfTurnLanded(undefined)).toBe(false);
  });
});
