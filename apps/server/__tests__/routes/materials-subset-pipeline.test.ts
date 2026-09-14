/**
 * F2 WQ2 Part 1 — subset-mode upload (`mode: "subset"`), the bandwidth-
 * saving page-subset contract WQ1's report §5 deferred. Fake model
 * provider throughout (`vi.mock("ai")`, same pattern as
 * materials-pdf-pipeline.test.ts) — zero real model calls. Single-page PDF
 * extracts are built with `pdf-lib` (test-only, see
 * `../support/pdf-fixtures.ts`) from the REAL `docs/guia1.pdf` (3 pages,
 * all cloud-tier per `reclassify.test.ts`) and `docs/guiaVA3.pdf` (2 pages,
 * page 1 cloud / page 2 local, per `materials-pdf-pipeline.test.ts`'s
 * "mixed-tier" case) — same fixtures WQ1 already validated, no new PDFs
 * needed.
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
import { extractSinglePagePdf } from "../support/pdf-fixtures";
import type { CourseBody, SubjectBody } from "../support/http-types";

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

interface SubsetManifestRow {
  pageNumber: number;
  claimedTier: "local" | "cloud";
  localText?: string | null;
}

function buildSubsetForm(options: {
  subjectId: string;
  totalPages: number;
  manifest: SubsetManifestRow[];
  cloudPages: Record<number, Uint8Array>;
}): FormData {
  const form = new FormData();
  form.set("subjectId", options.subjectId);
  form.set("mode", "subset");
  form.set("totalPages", String(options.totalPages));
  form.set("pages", JSON.stringify(options.manifest));
  for (const [pageNumber, bytes] of Object.entries(options.cloudPages)) {
    form.set(`cloudPage-${pageNumber}`, new File([new Uint8Array(bytes)], `page-${pageNumber}.pdf`, { type: "application/pdf" }));
  }
  return form;
}

describe("POST /v1/materials — subset mode (F2 WQ2 Part 1)", () => {
  let ctx: TestContext;
  let guia1Bytes: Uint8Array;
  let guiaVA3Bytes: Uint8Array;
  let prosaBioBytes: Uint8Array;

  beforeEach(async () => {
    generateTextMock.mockReset();
    guia1Bytes = new Uint8Array(await readFile(GUIA1_PATH));
    guiaVA3Bytes = new Uint8Array(await readFile(GUIA_VA3_PATH));
    prosaBioBytes = new Uint8Array(await readFile(PROSA_BIO_PATH));
  });

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setup(options: Parameters<typeof buildTestDeps>[0] = {}) {
    ctx = await buildTestDeps(options);
    const app = createApp(ctx.deps);
    const email = `wq2-subset-${Math.random().toString(36).slice(2)}@example.com`;
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

  it("happy path: guiaVA3.pdf split into subset (page 1 cloud bytes uploaded, page 2 kept local client-side) assembles in order", async () => {
    const { app, headers, subject } = await setup();
    generateTextMock.mockResolvedValueOnce({ text: "# Página 1 transcrita (subset)", usage: usageOf() });

    const cloudPage1 = await extractSinglePagePdf(guiaVA3Bytes, 1);
    const form = buildSubsetForm({
      subjectId: subject.id,
      totalPages: 2,
      manifest: [
        { pageNumber: 1, claimedTier: "cloud" },
        { pageNumber: 2, claimedTier: "local", localText: "Texto local página 2 (extraído por el cliente)." },
      ],
      cloudPages: { 1: cloudPage1 },
    });

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(201);
    const material = await readJson<MaterialBody>(res);

    expect(material.status).toBe("ready");
    expect(generateTextMock).toHaveBeenCalledTimes(1); // only the uploaded cloud page — the local page never triggers a model call
    expect(material.digestedTextRef).toContain("Página 1 transcrita (subset)");
    expect(material.digestedTextRef).toContain("Texto local página 2 (extraído por el cliente).");
    expect(material.digestedTextRef.indexOf("Página 1 transcrita")).toBeLessThan(material.digestedTextRef.indexOf("Texto local página 2"));

    expect(material.processingReport).toHaveLength(2);
    const cloudEntry = material.processingReport.find((e) => e.page === 1);
    const localEntry = material.processingReport.find((e) => e.page === 2);
    expect(cloudEntry).toMatchObject({ route: "cloud-page" });
    expect(cloudEntry?.costUsd).toBeGreaterThan(0);
    expect(localEntry).toMatchObject({ route: "local", costUsd: 0 });
  });

  it("client-lies-in-subset: bytes uploaded for a page claimed 'cloud' that is actually local-tier — server reclassifies and returns text WITHOUT transcribing", async () => {
    const { app, headers, subject } = await setup();

    // Antes se usaba guiaVA3 p2 como ejemplo de página local. Dejó de serlo
    // (a propósito) con la guardia de encoding de `544677d`: su texto digital
    // trae acentos partidos y ahora se rutea a la nube. La página local sana
    // pasa a ser prosa-bio p1 — sin ella este test probaba una premisa muerta.
    const lyingCloudPage = await extractSinglePagePdf(prosaBioBytes, 1);
    const form = buildSubsetForm({
      subjectId: subject.id,
      totalPages: 1,
      manifest: [{ pageNumber: 1, claimedTier: "cloud" }],
      cloudPages: { 1: lyingCloudPage },
    });

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(201);
    const material = await readJson<MaterialBody>(res);

    expect(material.status).toBe("ready");
    expect(generateTextMock).not.toHaveBeenCalled(); // the server never trusted the "cloud" claim — no transcription happened
    expect(material.processingReport).toHaveLength(1);
    expect(material.processingReport[0]).toMatchObject({ page: 1, route: "local", costUsd: 0 });
    expect(material.digestedTextRef.length).toBeGreaterThan(0); // real text, extracted server-side from the real bytes it received
  });

  it("ordering: local (no bytes) + cloud (real bytes) pages assemble by page number, independent of manifest/file submission order", async () => {
    const { app, headers, subject } = await setup();
    generateTextMock.mockResolvedValueOnce({ text: "CLOUD-P2-TRANSCRIBED", usage: usageOf() });

    const cloudPage2 = await extractSinglePagePdf(guia1Bytes, 2);
    const form = buildSubsetForm({
      subjectId: subject.id,
      totalPages: 3,
      // Manifest deliberately NOT in page-number order — the server must
      // sort by pageNumber, never trust submission order.
      manifest: [
        { pageNumber: 3, claimedTier: "local", localText: "LOCAL-P3" },
        { pageNumber: 1, claimedTier: "local", localText: "LOCAL-P1" },
        { pageNumber: 2, claimedTier: "cloud" },
      ],
      cloudPages: { 2: cloudPage2 },
    });

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(201);
    const material = await readJson<MaterialBody>(res);

    expect(material.status).toBe("ready");
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const idx1 = material.digestedTextRef.indexOf("LOCAL-P1");
    const idx2 = material.digestedTextRef.indexOf("CLOUD-P2-TRANSCRIBED");
    const idx3 = material.digestedTextRef.indexOf("LOCAL-P3");
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  it("quota: ingest daily cap of 1 cloud page blocks a 3-real-cloud-page subset upload before any model call", async () => {
    const { app, headers, subject } = await setup({ envOverrides: { QUOTA_DAILY_INGEST_CLOUD_PAGES: 1 } });

    const cloudPages = {
      1: await extractSinglePagePdf(guia1Bytes, 1),
      2: await extractSinglePagePdf(guia1Bytes, 2),
      3: await extractSinglePagePdf(guia1Bytes, 3),
    };
    const form = buildSubsetForm({
      subjectId: subject.id,
      totalPages: 3,
      manifest: [
        { pageNumber: 1, claimedTier: "cloud" },
        { pageNumber: 2, claimedTier: "cloud" },
        { pageNumber: 3, claimedTier: "cloud" },
      ],
      cloudPages,
    });

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(429);
    const body = await readJson<{ error: string; code: string }>(res);
    expect(body.code).toBe("quota_exceeded");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("partial degradation: the ingest chain exhausted for a cloud page degrades to a failure marker, material still persists as 'partial'", async () => {
    const { app, headers, subject } = await setup();
    // Test env's ingest chain resolves to exactly the floor model (raw
    // config {} in buildTestDeps -> single-candidate chain) — one rejection
    // exhausts it.
    generateTextMock.mockRejectedValueOnce(new Error("upstream 500"));

    const cloudPage1 = await extractSinglePagePdf(guiaVA3Bytes, 1);
    const form = buildSubsetForm({
      subjectId: subject.id,
      totalPages: 2,
      manifest: [
        { pageNumber: 1, claimedTier: "cloud" },
        { pageNumber: 2, claimedTier: "local", localText: "LOCAL-P2-OK" },
      ],
      cloudPages: { 1: cloudPage1 },
    });

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(201);
    const material = await readJson<MaterialBody>(res);

    expect(material.status).toBe("partial");
    expect(material.digestedTextRef).toContain("[Página no transcrita: fallo al transcribir esta página]");
    expect(material.digestedTextRef).toContain("LOCAL-P2-OK");
    const cloudEntry = material.processingReport.find((e) => e.page === 1);
    expect(cloudEntry).toMatchObject({ route: "cloud-page", costUsd: 0 });
  });

  it("protocol violation: manifest claims a page as 'cloud' but no bytes were uploaded for it -> 400 invalid_request", async () => {
    const { app, headers, subject } = await setup();

    const form = buildSubsetForm({
      subjectId: subject.id,
      totalPages: 1,
      manifest: [{ pageNumber: 1, claimedTier: "cloud" }],
      cloudPages: {}, // missing
    });

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; code: string }>(res);
    expect(body.code).toBe("invalid_request");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("protocol violation: a 'local' page with no localText -> 400 invalid_request", async () => {
    const { app, headers, subject } = await setup();

    const form = buildSubsetForm({
      subjectId: subject.id,
      totalPages: 1,
      manifest: [{ pageNumber: 1, claimedTier: "local" }], // no localText
      cloudPages: {},
    });

    const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; code: string }>(res);
    expect(body.code).toBe("invalid_request");
  });
});
