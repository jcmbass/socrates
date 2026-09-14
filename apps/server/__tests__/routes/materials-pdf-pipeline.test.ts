/**
 * F2 WQ1 — the activated materials multipart PDF pipeline, full route flow
 * against a FAKE model provider (never the real SDK/API — `vi.mock("ai")`,
 * same pattern as sessions-happy.test.ts). Uses the REAL `docs/guia1.pdf`
 * fixture (server-side text/operator-list extraction is real; only the
 * vision transcription call is mocked).
 *
 * FINDING (flagged for architect review, see also
 * docs/plan-app-multiplataforma/reports/wq1-reporte.md): under this
 * pipeline's real server-side pdf.js parsing, `docs/guia1.pdf`'s 3 pages
 * ALL classify as `cloud-page` (verified in `__tests__/materials/
 * reclassify.test.ts`) — `pdfjs-dist`'s Node build resolves
 * `textContent.styles[alias].fontFamily` to a generic CSS fallback
 * ("sans-serif"/"monospace"), never the real embedded font name
 * (e.g. "CMMI10") `classify.ts`'s `MATH_FONT_RE` regex is written against,
 * so its math-font signal never fires — the page still routes to
 * `cloud-page` via the ruled-grid/table signal instead, which is
 * plausibly ALSO what a real browser run would do (unverified — this
 * gap is in the SHARED pdf.js text-content API, not something Node-specific
 * this port introduced). A genuinely mixed local+cloud upload is exercised
 * separately below with `docs/guiaVA3.pdf` (2 pages: page 1 cloud, page 2
 * local — real diversity, confirmed via the same reclassify path).
 */
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: generateTextMock };
});

import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody } from "../support/http-types";
import type { RecordingSafetyNotifier } from "../../src/safety/incident";
import { getOrCreateQuota } from "../../src/repositories/quotas";

interface MaterialBody {
  id: string;
  status: string;
  kind: string;
  digestedTextRef: string;
  processingReport: Array<{ page: number | null; route: string; costUsd: number; cached: boolean }>;
}

const GUIA1_PATH = new URL("../../../../docs/guia1.pdf", import.meta.url);
const GUIA_VA3_PATH = new URL("../../../../docs/guiaVA3.pdf", import.meta.url);
const PROSA_BIO_PATH = new URL("../../../../docs/prosa-bio.pdf", import.meta.url);

function usageOf(inputTokens = 500, outputTokens = 200) {
  return { inputTokens, outputTokens, inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 } };
}

async function loadPdfFile(url: URL, name: string): Promise<File> {
  const bytes = await readFile(url);
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

describe("POST /v1/materials — F2 WQ1 activated PDF pipeline (fake transcribe, zero real model calls)", () => {
  let ctx: TestContext;

  beforeEach(() => {
    generateTextMock.mockReset();
  });

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setup(options: Parameters<typeof buildTestDeps>[0] = {}) {
    ctx = await buildTestDeps(options);
    const app = createApp(ctx.deps);
    const email = `wq1-${Math.random().toString(36).slice(2)}@example.com`;
    const { token, userId } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}` };
    const jsonHeaders = { ...headers, "content-type": "application/json" };

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ courseId: course.id, name: "Matemática" }) }),
    );

    return { app, headers, userId, subject };
  }

  it("happy path: uploads docs/guia1.pdf, transcribes all 3 cloud-tier pages via the mocked C7 ingest chain, assembles the material in page order", async () => {
    const { app, headers, subject } = await setup();
    generateTextMock
      .mockResolvedValueOnce({ text: "# Página uno transcrita", usage: usageOf() })
      .mockResolvedValueOnce({ text: "# Página dos transcrita", usage: usageOf() })
      .mockResolvedValueOnce({ text: "# Página tres transcrita", usage: usageOf() });

    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("file", await loadPdfFile(GUIA1_PATH, "guia1.pdf"));

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(201);
    const material = await readJson<MaterialBody>(res);

    expect(material.status).toBe("ready");
    expect(material.kind).toBe("pdf");
    expect(generateTextMock).toHaveBeenCalledTimes(3);
    expect(material.digestedTextRef).toContain("Página uno transcrita");
    expect(material.digestedTextRef).toContain("Página dos transcrita");
    expect(material.digestedTextRef).toContain("Página tres transcrita");
    expect(material.digestedTextRef.indexOf("uno")).toBeLessThan(material.digestedTextRef.indexOf("dos"));
    expect(material.digestedTextRef.indexOf("dos")).toBeLessThan(material.digestedTextRef.indexOf("tres"));

    expect(material.processingReport).toHaveLength(3);
    for (const entry of material.processingReport) {
      expect(entry.route).toBe("cloud-page");
      expect(entry.costUsd).toBeGreaterThan(0);
    }
  });

  it("guiaVA3.pdf: la guardia de encoding manda AMBAS páginas a la nube — la p2 tenía texto digital corrupto ('soluci´ on') que antes se servía como Tier-0", async () => {
    // Este test afirmaba lo contrario: que la p2 se extraía local a $0. Dejó de
    // ser cierto (a propósito) con la guardia de `544677d`: su texto digital
    // trae acentos partidos, y servirlo como material de estudio le entrega
    // basura al tutor. Principio del pipeline: grounding correcto > ahorro.
    // Costo del cambio, explícito: guiaVA3 pasa de 1 a 2 páginas de nube.
    const { app, headers, subject } = await setup();
    generateTextMock
      .mockResolvedValueOnce({ text: "# Página 1 transcrita", usage: usageOf() })
      .mockResolvedValueOnce({ text: "# Página 2 transcrita", usage: usageOf() });

    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("file", await loadPdfFile(GUIA_VA3_PATH, "guiaVA3.pdf"));

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(201);
    const material = await readJson<MaterialBody>(res);

    expect(material.status).toBe("ready");
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(material.processingReport).toHaveLength(2);
    for (const entry of material.processingReport) {
      expect(entry.route).toBe("cloud-page");
      expect(entry.costUsd).toBeGreaterThan(0);
    }
    expect(material.digestedTextRef).toContain("Página 1 transcrita");
    expect(material.digestedTextRef).toContain("Página 2 transcrita");
  });

  it("prosa-bio.pdf (texto digital limpio): se extrae local a $0 y NUNCA llama al modelo", async () => {
    // Reemplaza la cobertura del camino Tier-0 que guiaVA3 dejó de dar. Es la
    // otra mitad del principio: si el texto digital está SANO, no se paga.
    const { app, headers, subject } = await setup();

    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("file", await loadPdfFile(PROSA_BIO_PATH, "prosa-bio.pdf"));

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(201);
    const material = await readJson<MaterialBody>(res);

    expect(material.status).toBe("ready");
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(material.processingReport).toHaveLength(1);
    expect(material.processingReport[0].route).toBe("local");
    expect(material.processingReport[0].costUsd).toBe(0);
  });

  it("client-lies-about-tier: client claims all 3 pages of guia1.pdf are 'local' — server re-classifies and transcribes them all anyway (risk #2)", async () => {
    const { app, headers, subject } = await setup();
    generateTextMock
      .mockResolvedValueOnce({ text: "# Real transcription 1", usage: usageOf() })
      .mockResolvedValueOnce({ text: "# Real transcription 2", usage: usageOf() })
      .mockResolvedValueOnce({ text: "# Real transcription 3", usage: usageOf() });

    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("file", await loadPdfFile(GUIA1_PATH, "guia1.pdf"));
    // The client's claim is a LIE (guia1.pdf's pages are all cloud-tier,
    // confirmed in reclassify.test.ts) — the pipeline must ignore this
    // entirely and re-derive the route itself.
    form.set(
      "pages",
      JSON.stringify([
        { pageNumber: 1, claimedTier: "local" },
        { pageNumber: 2, claimedTier: "local" },
        { pageNumber: 3, claimedTier: "local" },
      ]),
    );

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(201);
    const material = await readJson<MaterialBody>(res);

    // If the server had trusted the client's "local" claim, it would have
    // extracted $0 text and never called the model at all.
    expect(generateTextMock).toHaveBeenCalledTimes(3);
    expect(material.processingReport.every((e) => e.route === "cloud-page")).toBe(true);
    expect(material.digestedTextRef).toContain("Real transcription 1");
  });

  it("oversized rejection: a PDF over MAX_UPLOAD_PDF_BYTES is rejected before any parsing/model work", async () => {
    const { app, headers, subject } = await setup();

    const oversized = new Uint8Array(32 * 1024 * 1024 + 1);
    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("file", new File([oversized], "huge.pdf", { type: "application/pdf" }));

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; code: string }>(res);
    expect(body.code).toBe("invalid_request");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("quota exceeded: ingest daily cap of 1 cloud page blocks a 3-cloud-page upload before any model call", async () => {
    const { app, headers, subject } = await setup({ envOverrides: { QUOTA_DAILY_INGEST_CLOUD_PAGES: 1 } });

    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("file", await loadPdfFile(GUIA1_PATH, "guia1.pdf"));

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(429);
    const body = await readJson<{ error: string; code: string }>(res);
    expect(body.code).toBe("quota_exceeded");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("safety block: a transcribed page matching the safety classifier's canary pattern blocks the whole material, persists a SafetyIncident, never creates the material", async () => {
    const { app, headers, subject, userId } = await setup();
    generateTextMock.mockResolvedValueOnce({ text: "ya no quiero seguir viviendo", usage: usageOf() });

    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("file", await loadPdfFile(GUIA1_PATH, "guia1.pdf"));

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(200); // safety_blocked's reserved status, same as the chat route (errors.ts)
    const body = await readJson<{ error: string; code: string }>(res);
    expect(body.code).toBe("safety_blocked");

    // Only the first (flagged) page's transcription happened — the pipeline
    // aborts before touching pages 2/3.
    expect(generateTextMock).toHaveBeenCalledTimes(1);

    const notifier = ctx.deps.safetyNotifier as RecordingSafetyNotifier;
    expect(notifier.notified).toHaveLength(1);
    expect(notifier.notified[0]).toMatchObject({ userId, category: "self_harm" });
  });

  it("ingest usage is recorded on the quota row after a successful transcription", async () => {
    const { app, headers, subject, userId } = await setup();
    generateTextMock.mockResolvedValueOnce({ text: "# Página rasterizada transcrita", usage: usageOf() });

    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("file", await loadPdfFile(GUIA_VA3_PATH, "guiaVA3.pdf"));

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(201);

    const dailyQuota = await getOrCreateQuota(ctx.deps.db, userId, "daily", { capTutorMessages: null, capCostUsd: null });
    expect(dailyQuota.ingestCloudCallsUsed).toBe(1);
    expect(dailyQuota.costUsdEstimate).toBeGreaterThan(0);
  });
});
