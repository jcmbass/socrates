import { describe, it, expect } from "vitest";
import { stripOuterMarkdownFence } from "../execution/ingest";

/**
 * Defecto medido 2026-08-02: el VLM envuelve TODA su salida en una cerca
 * ```markdown y eso llegó a persistirse dentro del material de estudio real
 * (verificado end-to-end contra el servidor: el texto guardado de guiaVA3.pdf
 * empezaba con "```markdown"). El estudiante lo veía al abrir su Fuente.
 */
describe("stripOuterMarkdownFence", () => {
  it("quita el envoltorio ```markdown que el VLM pone alrededor de toda la página", () => {
    const raw = "```markdown\n# GUÍA 3\n\nContenido real.\n```";
    expect(stripOuterMarkdownFence(raw)).toBe("# GUÍA 3\n\nContenido real.");
  });

  it("acepta también la etiqueta corta ```md", () => {
    expect(stripOuterMarkdownFence("```md\nhola\n```")).toBe("hola");
  });

  it("NO toca un bloque de código real de otro lenguaje — una página de libro de programación puede ser un solo bloque", () => {
    const raw = "```python\nfor i in range(10):\n    print(i)\n```";
    expect(stripOuterMarkdownFence(raw)).toBe(raw);
  });

  it("NO toca una cerca SIN etiqueta — no se puede distinguir de pseudocódigo legítimo (Cormen)", () => {
    const raw = "```\nMERGE-SORT(A, p, r)\n```";
    expect(stripOuterMarkdownFence(raw)).toBe(raw);
  });

  it("NO toca texto que solo CONTIENE una cerca en el medio (no es un envoltorio)", () => {
    const raw = "Antes del código:\n\n```python\nx = 1\n```\n\nDespués del código.";
    expect(stripOuterMarkdownFence(raw)).toBe(raw);
  });

  it("NO desenvuelve si adentro sobrevive otra cerca — ante la duda no se toca", () => {
    const raw = "```markdown\ntexto\n\n```python\ny = 2\n```\n\nmás texto\n```";
    expect(stripOuterMarkdownFence(raw)).toBe(raw);
  });

  it("deja intacto el texto normal sin cercas", () => {
    const raw = "UNIVERSIDAD DE SANTIAGO\n\n$|x^2 - x| = 4$";
    expect(stripOuterMarkdownFence(raw)).toBe(raw);
  });

  it("tolera espacios/saltos alrededor del envoltorio", () => {
    expect(stripOuterMarkdownFence("\n  ```markdown\ncuerpo\n```  \n")).toBe("cuerpo");
  });

  it("no rompe con entradas degeneradas", () => {
    expect(stripOuterMarkdownFence("")).toBe("");
    expect(stripOuterMarkdownFence("```")).toBe("```");
    expect(stripOuterMarkdownFence("```markdown```")).toBe("```markdown```");
  });
});
