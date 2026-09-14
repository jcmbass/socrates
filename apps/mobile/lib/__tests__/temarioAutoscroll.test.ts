import { describe, expect, it } from "vitest";

import { nodeCenterY } from "../skillTreeRail";
import { resolveAutoScrollTarget, type AutoScrollTargetInput } from "../temarioAutoscroll";

/** Caso base "sano": tree alto, viewport de teléfono, estudiante sin tocar nada. */
function baseInput(overrides: Partial<AutoScrollTargetInput> = {}): AutoScrollTargetInput {
  return {
    recommendedCenterY: 1000,
    contentTopPadding: 16,
    viewportHeight: 600,
    contentHeight: 2000,
    currentScrollY: 0,
    viewportAnchor: 0.5,
    studentScrollTolerance: 24,
    minTravel: 8,
    ...overrides,
  };
}

describe("resolveAutoScrollTarget", () => {
  it("centra el nodo recomendado en el viewport", () => {
    // 16 + 1000 - 600*0.5 = 716
    expect(resolveAutoScrollTarget(baseInput())).toBe(716);
  });

  it("el anclaje corre el nodo dentro del viewport sin tocar nada más", () => {
    // anchor 0.6 => el nodo aterriza al 60% desde arriba (MÁS ABAJO en
    // pantalla), o sea que hace falta MENOS scroll.
    expect(resolveAutoScrollTarget(baseInput({ viewportAnchor: 0.6 }))).toBe(656);
    // anchor 0.4 => el nodo queda MÁS ARRIBA => más scroll.
    expect(resolveAutoScrollTarget(baseInput({ viewportAnchor: 0.4 }))).toBe(776);
  });

  it("un nodo tras el anclaje deja el destino centrado a esa fracción exacta", () => {
    const viewportHeight = 600;
    const anchor = 0.56;
    const target = resolveAutoScrollTarget(
      baseInput({ viewportHeight, viewportAnchor: anchor }),
    );
    // Posición en pantalla = (padding + centerY) - target. Debe caer justo
    // en la fracción pedida del viewport.
    const onScreenY = 16 + 1000 - target!;
    expect(onScreenY).toBeCloseTo(viewportHeight * anchor, 10);
  });

  it("consume la geometría real del rail (misma fuente que el SVG)", () => {
    const pitch = 128;
    const recommendedIndex = 3;
    const target = resolveAutoScrollTarget(
      baseInput({ recommendedCenterY: nodeCenterY(recommendedIndex, pitch) }),
    );
    // nodeCenterY(3,128) = 448 -> 16 + 448 - 300 = 164
    expect(target).toBe(164);
  });

  it("nunca devuelve un offset fuera del rango scrolleable", () => {
    // Recomendado al final del contenido: se topa contra maxOffset (1400).
    expect(resolveAutoScrollTarget(baseInput({ recommendedCenterY: 5000 }))).toBe(1400);
    // Recomendado arriba de todo: se topa contra 0... y por eso no vale la pena.
    expect(resolveAutoScrollTarget(baseInput({ recommendedCenterY: 10 }))).toBeNull();
  });

  it("se abstiene cuando no hay tema recomendado", () => {
    expect(resolveAutoScrollTarget(baseInput({ recommendedCenterY: null }))).toBeNull();
  });

  it("se abstiene mientras no haya medidas", () => {
    expect(resolveAutoScrollTarget(baseInput({ viewportHeight: 0 }))).toBeNull();
    expect(resolveAutoScrollTarget(baseInput({ contentHeight: 0 }))).toBeNull();
  });

  it("se abstiene cuando el contenido entra entero en pantalla", () => {
    expect(resolveAutoScrollTarget(baseInput({ contentHeight: 600, viewportHeight: 600 }))).toBeNull();
    expect(resolveAutoScrollTarget(baseInput({ contentHeight: 500, viewportHeight: 600 }))).toBeNull();
  });

  it("se abstiene si el estudiante ya scrolleó por su cuenta", () => {
    expect(resolveAutoScrollTarget(baseInput({ currentScrollY: 25 }))).toBeNull();
    // Justo en el borde de tolerancia todavía autoscrollea.
    expect(resolveAutoScrollTarget(baseInput({ currentScrollY: 24 }))).toBe(716);
  });

  it("se abstiene cuando el recorrido sería despreciable", () => {
    // Destino 716 con el estudiante ya en 710: 6px de recorrido < minTravel 8.
    expect(resolveAutoScrollTarget(baseInput({ currentScrollY: 710, studentScrollTolerance: 10_000 }))).toBeNull();
    expect(resolveAutoScrollTarget(baseInput({ currentScrollY: 700, studentScrollTolerance: 10_000 }))).toBe(716);
  });
});
