import { describe, expect, it } from "vitest";

import { isSubjectSourcesEntryActive, sourcesReconcileSubjectId, type SubjectSourcesEntryInput } from "../subjectSourcesEntry";

const ARBOL_VISIBLE: SubjectSourcesEntryInput = {
  loading: false,
  error: false,
  temarioEmpty: false,
  buildingTemario: false,
  editing: false,
};

describe("isSubjectSourcesEntryActive (obs. 2a — subir material desde la materia)", () => {
  it("está activa cuando la pantalla muestra el árbol de verdad", () => {
    expect(isSubjectSourcesEntryActive(ARBOL_VISIBLE)).toBe(true);
  });

  it.each<[string, Partial<SubjectSourcesEntryInput>]>([
    ["mientras carga el temario", { loading: true }],
    ["cuando el fetch falló", { error: true }],
    ["con el temario vacío (ese estado ya tiene su propio Subir PDF)", { temarioEmpty: true }],
    ["mientras se arma el temario desde un PDF", { buildingTemario: true }],
    ["con el editor manual de temas abierto", { editing: true }],
  ])("se apaga %s", (_caso, override) => {
    expect(isSubjectSourcesEntryActive({ ...ARBOL_VISIBLE, ...override })).toBe(false);
  });

  it("el estado vacío gana aunque el árbol ya no esté cargando", () => {
    // El bug que este guard evita: dos botones de 'subir PDF' a la vez con
    // consecuencias distintas (uno genera el temario, el otro solo adjunta).
    expect(isSubjectSourcesEntryActive({ ...ARBOL_VISIBLE, temarioEmpty: true, loading: false })).toBe(false);
  });
});

describe("sourcesReconcileSubjectId (kill-switch del reconcile de huérfanos)", () => {
  it("pasa el subjectId real cuando la entrada está activa", () => {
    expect(sourcesReconcileSubjectId("subj-1", true)).toBe("subj-1");
  });

  it('devuelve "" cuando la entrada está apagada — el hook corta su reconcile con eso', () => {
    expect(sourcesReconcileSubjectId("subj-1", false)).toBe("");
  });

  it('devuelve "" si todavía no hay subjectId en la ruta', () => {
    expect(sourcesReconcileSubjectId(undefined, true)).toBe("");
    expect(sourcesReconcileSubjectId(undefined, false)).toBe("");
  });
});
