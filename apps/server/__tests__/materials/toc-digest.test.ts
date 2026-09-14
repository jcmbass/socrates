/**
 * Book-index path (plan-temario-indice) — pure locate/format guards + real
 * PDF end-to-end through digestMaterialPdf. Zero paid API calls.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  BOOK_INDEX_FUENTE_HEADER,
  formatTemarioDraftMarkdown,
  locateBookIndex,
  pageHasUsableDigitalText,
  digestLargePdfAsBookIndex,
  TOC_MAX_EXTRACT_PAGES,
} from "../../src/materials/toc-digest";
import {
  digestMaterialPdf,
  MaterialTooLargeError,
  type DigestMaterialPdfDeps,
} from "../../src/materials/pipeline";
import type { OutlineEntry, TemarioDraft } from "@buxo/pdf/toc";
import type { NormalizedPage } from "@buxo/pdf/types";

const CORMEN_PATH = new URL("../../../../docs/introduction-to-algorithms-cormen-solution-2nd.pdf", import.meta.url);
const PROSA_BIO_PATH = new URL("../../../../docs/prosa-bio.pdf", import.meta.url);
const CALCULO_PATH = new URL("../../../../docs/calculo-multivariable.pdf", import.meta.url);

function emptyPage(pageNumber: number, text = ""): NormalizedPage {
  return {
    pageNumber,
    width: 612,
    height: 792,
    textItems: text
      ? [{ str: text, x: 72, y: 720, width: 100, height: 12, fontName: "Helvetica" }]
      : [],
    images: [],
    paths: { horizontalSegments: 0, verticalSegments: 0, rectangles: 0 },
  };
}

function fakeDeps(overrides: Partial<DigestMaterialPdfDeps> = {}): DigestMaterialPdfDeps {
  return {
    models: {
      createIngestAdapter: () => {
        throw new Error("ingest adapter must not be called in these tests");
      },
    },
    safetyClassifier: {
      classify: async () => ({
        category: "none" as const,
        confidence: 1,
        providerId: "test",
        modelId: "test",
      }),
    },
    checkIngestQuota: async () => ({ ok: true as const }),
    recordIngestUsage: async () => {},
    ...overrides,
  };
}

describe("locateBookIndex", () => {
  it("prefers an outline Contents locator over bare chapter bookmarks", () => {
    const outline: OutlineEntry[] = [
      { level: 1, title: "Contents", pageNumber: 3 },
      { level: 1, title: "Chapter 2", pageNumber: 11 },
      { level: 1, title: "Chapter 3", pageNumber: 35 },
    ];
    const result = locateBookIndex({ outline, candidatePages: [], numPages: 429 });
    expect(result).toEqual({ found: true, via: "outline-locator", pageNumbers: [3] });
  });

  it("returns not-found when outline is empty and no candidate page looks like a TOC", () => {
    const result = locateBookIndex({
      outline: [],
      candidatePages: [emptyPage(1, "Solo prosa sin forma de índice.")],
      numPages: 50,
    });
    expect(result).toEqual({ found: false });
  });

  it("reports outline-rich without requiring pages", () => {
    const outline: OutlineEntry[] = [
      { level: 1, title: "I.- IDENTIFICACIÓN", pageNumber: 1 },
      { level: 1, title: "II.- OBJETIVOS", pageNumber: 2 },
      { level: 1, title: "III.- COMPETENCIAS", pageNumber: 3 },
    ];
    const result = locateBookIndex({ outline, candidatePages: [], numPages: 12 });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.via).toBe("outline-rich");
    expect(result.pageNumbers).toEqual([]);
    expect(result.draftFromOutline?.chapters.map((c) => c.title)).toEqual([
      "I.- IDENTIFICACIÓN",
      "II.- OBJETIVOS",
      "III.- COMPETENCIAS",
    ]);
  });
});

/**
 * HUECO ENCONTRADO POR MUTACIÓN (arquitecto, 2026-08-02): poner
 * `TOC_PREFIX_SCAN_PAGES = 0` dejaba los 317 tests en verde. El camino del
 * outline estaba cubierto (Cormen lo trae), pero el HEURÍSTICO —el camino
 * COMÚN, porque solo 2 de los 8 PDFs del corpus tienen outline— no tenía
 * ninguna prueba. Estos tests cubren ese hueco.
 */
describe("locateBookIndex — camino heurístico (sin outline)", () => {
  /** Página con forma de índice: títulos + número de página, líneas cortas. */
  function tocLikePage(pageNumber: number): NormalizedPage {
    const lines = [
      "Índice",
      "Capítulo 1: Números reales .... 1",
      "Capítulo 2: Desigualdades .... 15",
      "Capítulo 3: Valor absoluto .... 31",
      "Capítulo 4: Funciones .... 48",
      "Capítulo 5: Límites .... 66",
      "Capítulo 6: Derivadas .... 84",
    ];
    return {
      pageNumber,
      width: 612,
      height: 792,
      textItems: lines.map((str, i) => ({
        str,
        x: 72,
        y: 720 - i * 22,
        width: 380,
        height: 12,
        fontName: "Helvetica",
      })),
      images: [],
      paths: { horizontalSegments: 0, verticalSegments: 0, rectangles: 0 },
    };
  }

  it("encuentra el índice SIN outline y lo marca como 'heuristic'", () => {
    const result = locateBookIndex({
      outline: [],
      candidatePages: [emptyPage(1, "Portada"), tocLikePage(2), emptyPage(3, "Prefacio")],
      numPages: 400,
    });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.via).toBe("heuristic");
    expect(result.pageNumbers).toContain(2);
  });

  it("NO confunde prosa corriente con un índice (falso positivo caro: mandaría a transcribir la página equivocada)", () => {
    const prosa = emptyPage(2, "La célula es la unidad básica de los seres vivos y contiene organelos.");
    const result = locateBookIndex({
      outline: [],
      candidatePages: [emptyPage(1, "Portada"), prosa],
      numPages: 400,
    });
    expect(result.found).toBe(false);
  });

  it("no devuelve más de TOC_MAX_EXTRACT_PAGES páginas aunque haya muchas candidatas", () => {
    const result = locateBookIndex({
      outline: [],
      candidatePages: [2, 3, 4, 5, 6].map(tocLikePage),
      numPages: 400,
    });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.pageNumbers.length).toBeLessThanOrEqual(TOC_MAX_EXTRACT_PAGES);
  });
});

describe("formatTemarioDraftMarkdown + header contract", () => {
  it("renders chapter/section hierarchy and the persisted header names the index honestly", () => {
    const draft: TemarioDraft = {
      chapters: [
        {
          title: "Chapter 2: Getting Started",
          pageNumber: null,
          sections: [{ title: "Lecture Notes", pageNumber: "2-1", level: 2 }],
        },
      ],
      orphanSections: [],
    };
    const body = formatTemarioDraftMarkdown(draft);
    expect(body).toContain("## Chapter 2: Getting Started");
    expect(body).toContain("Lecture Notes (p. 2-1)");
    expect(BOOK_INDEX_FUENTE_HEADER).toMatch(/Índice del libro/i);
    expect(BOOK_INDEX_FUENTE_HEADER).toMatch(/no es el temario/i);
  });
});

describe("pageHasUsableDigitalText", () => {
  it("rejects empty pages", () => {
    expect(pageHasUsableDigitalText(emptyPage(1))).toBe(false);
  });
});

describe("digestMaterialPdf — book-index path (real Cormen PDF, $0)", () => {
  it("429-page algorithms book yields real chapter names from the Contents pages, not bare 'Chapter 2'", async () => {
    const bytes = new Uint8Array(await readFile(CORMEN_PATH));
    const result = await digestMaterialPdf({ pdfBytes: bytes, subject: "Algoritmos" }, fakeDeps());

    expect(result.status).toBe("ready");
    expect(result.assembledText).toContain("Índice del libro");
    expect(result.assembledText).toContain("Getting Started");
    expect(result.assembledText).toContain("Growth of Functions");
    expect(result.assembledText).toMatch(/Chapter 2:\s*Getting Started/);
    expect(result.processingReport.length).toBeGreaterThanOrEqual(1);
    expect(result.processingReport.length).toBeLessThanOrEqual(3);
    expect(result.processingReport.every((e) => e.route === "local" && e.costUsd === 0)).toBe(true);
    for (const entry of result.processingReport) {
      expect(entry.page).toBeGreaterThanOrEqual(3);
      expect(entry.page).toBeLessThanOrEqual(5);
    }
  }, 60_000);
});

describe("digestMaterialPdf — no index → MaterialTooLargeError preserved", () => {
  it("calculo-multivariable.pdf (32 págs, sin outline ni índice) sigue rechazándose", async () => {
    const bytes = new Uint8Array(await readFile(CALCULO_PATH));
    await expect(digestMaterialPdf({ pdfBytes: bytes, subject: "Cálculo" }, fakeDeps())).rejects.toBeInstanceOf(
      MaterialTooLargeError,
    );
    await expect(digestMaterialPdf({ pdfBytes: bytes, subject: "Cálculo" }, fakeDeps())).rejects.toThrow(/no book index found/);
  }, 60_000);

  it("digestLargePdfAsBookIndex returns not_found on a short PDF forced into the large path without TOC shape", async () => {
    const bytes = new Uint8Array(await readFile(PROSA_BIO_PATH));
    const outcome = await digestLargePdfAsBookIndex(
      { pdfBytes: bytes, numPages: 100, outline: [], subject: undefined },
      {
        ...fakeDeps(),
        transcribeCloudPage: async () => ({
          text: "",
          costUsd: 0,
          failed: true,
          cached: false,
          timings: { rasterMs: 0, modelMs: 0, safetyMs: 0, totalMs: 0 },
        }),
      },
    );
    expect(outcome.kind).toBe("not_found");
  });
});

describe("digestMaterialPdf — small PDFs unchanged", () => {
  it("prosa-bio.pdf still digests as a single local page (no book-index header)", async () => {
    const bytes = new Uint8Array(await readFile(PROSA_BIO_PATH));
    const result = await digestMaterialPdf({ pdfBytes: bytes, subject: "Bio" }, fakeDeps());
    expect(result.status).toBe("ready");
    expect(result.assembledText).not.toContain("Índice del libro");
    expect(result.processingReport).toHaveLength(1);
    expect(result.processingReport[0].route).toBe("local");
  });
});
