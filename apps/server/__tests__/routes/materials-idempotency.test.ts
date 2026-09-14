/**
 * Material upload idempotency — same spirit as sessions-idempotency
 * (beta-real 10 / turn_claims). Same clientUploadId ⇒ one material, one
 * digest charge. A mid-flight duplicate returns 409 duplicate_material.
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
import {
  beginMaterialDigest,
  listMaterialsBySubject,
  MATERIAL_DIGEST_ORPHAN_MS,
  setMaterialCreatedAtForTests,
} from "../../src/repositories/materials";
import { eq } from "drizzle-orm";
import { materialAssets } from "../../src/db/schema";

const GUIA_VA3_PATH = new URL("../../../../docs/guiaVA3.pdf", import.meta.url);

function usageOf(inputTokens = 500, outputTokens = 200) {
  return {
    inputTokens,
    outputTokens,
    inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

async function loadPdfFile(url: URL, name: string): Promise<File> {
  const bytes = await readFile(url);
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

describe("POST /v1/materials — clientUploadId idempotency", () => {
  let ctx: TestContext;

  beforeEach(() => {
    generateTextMock.mockReset();
  });

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setup() {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const email = `mat-idem-${Math.random().toString(36).slice(2)}@example.com`;
    const { token, userId } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}` };
    const jsonHeaders = { ...headers, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }),
      }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ courseId: course.id, name: "Matemática" }),
      }),
    );
    return { app, headers, userId, subject };
  }

  it("same clientUploadId twice → one material and one digest charge", async () => {
    const { app, headers, subject, userId } = await setup();
    // guiaVA3: at least one vision call (page mix may vary by classifier).
    generateTextMock.mockResolvedValue({ text: "# Página cloud", usage: usageOf() });

    const form1 = new FormData();
    form1.set("subjectId", subject.id);
    form1.set("clientUploadId", "cu-same-1");
    form1.set("file", await loadPdfFile(GUIA_VA3_PATH, "guiaVA3.pdf"));

    const res1 = await app.request("/v1/materials", { method: "POST", headers, body: form1 });
    expect(res1.status).toBe(201);
    const first = await readJson<{ id: string; status: string }>(res1);
    expect(first.status).toBe("ready");
    const chargesAfterFirst = generateTextMock.mock.calls.length;
    expect(chargesAfterFirst).toBeGreaterThan(0);

    const form2 = new FormData();
    form2.set("subjectId", subject.id);
    form2.set("clientUploadId", "cu-same-1");
    form2.set("file", await loadPdfFile(GUIA_VA3_PATH, "guiaVA3.pdf"));

    const res2 = await app.request("/v1/materials", { method: "POST", headers, body: form2 });
    expect(res2.status).toBe(409);
    expect((await readJson<{ code: string }>(res2)).code).toBe("duplicate_material");
    // Central invariant: no second digest charge.
    expect(generateTextMock).toHaveBeenCalledTimes(chargesAfterFirst);

    const list = await listMaterialsBySubject(ctx.deps.db, userId, subject.id);
    const pdfs = list.filter((m) => m.kind === "pdf");
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0]!.id).toBe(first.id);
  });

  it("in-flight duplicate (digesting) → 409 without a second digest", async () => {
    const { app, headers, subject, userId } = await setup();

    // Hold the first digest open so the second POST arrives while status=digesting.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    generateTextMock.mockImplementation(async () => {
      await gate;
      return { text: "# Página cloud", usage: usageOf() };
    });

    const form1 = new FormData();
    form1.set("subjectId", subject.id);
    form1.set("clientUploadId", "cu-inflight");
    form1.set("file", await loadPdfFile(GUIA_VA3_PATH, "guiaVA3.pdf"));
    const firstPromise = app.request("/v1/materials", { method: "POST", headers, body: form1 });

    // Wait until the digesting row exists.
    for (let i = 0; i < 50; i++) {
      const rows = await ctx.deps.db
        .select()
        .from(materialAssets)
        .where(eq(materialAssets.userId, userId));
      if (rows.some((r) => r.status === "digesting" && r.clientUploadId === "cu-inflight")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const form2 = new FormData();
    form2.set("subjectId", subject.id);
    form2.set("clientUploadId", "cu-inflight");
    form2.set("file", await loadPdfFile(GUIA_VA3_PATH, "guiaVA3.pdf"));
    const res2 = await app.request("/v1/materials", { method: "POST", headers, body: form2 });
    expect(res2.status).toBe(409);
    expect((await readJson<{ code: string }>(res2)).code).toBe("duplicate_material");

    release();
    const res1 = await firstPromise;
    expect(res1.status).toBe(201);
    const charges = generateTextMock.mock.calls.length;
    expect(charges).toBeGreaterThan(0);

    const list = await listMaterialsBySubject(ctx.deps.db, userId, subject.id);
    expect(list.filter((m) => m.kind === "pdf")).toHaveLength(1);
  });

  it("without clientUploadId keeps pre-idempotency behaviour (two materials)", async () => {
    const { app, headers, subject, userId } = await setup();
    generateTextMock.mockResolvedValue({ text: "# Página cloud", usage: usageOf() });

    for (let i = 0; i < 2; i++) {
      const form = new FormData();
      form.set("subjectId", subject.id);
      form.set("file", await loadPdfFile(GUIA_VA3_PATH, "guiaVA3.pdf"));
      const res = await app.request("/v1/materials", { method: "POST", headers, body: form });
      expect(res.status).toBe(201);
    }
    expect(generateTextMock.mock.calls.length).toBeGreaterThan(0);
    const list = await listMaterialsBySubject(ctx.deps.db, userId, subject.id);
    expect(list.filter((m) => m.kind === "pdf")).toHaveLength(2);
  });

  it("GET list exposes digesting while work is in flight", async () => {
    const { app, headers, subject } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    generateTextMock.mockImplementation(async () => {
      await gate;
      return { text: "# Página cloud", usage: usageOf() };
    });

    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("clientUploadId", "cu-visible");
    form.set("file", await loadPdfFile(GUIA_VA3_PATH, "guiaVA3.pdf"));
    const uploadPromise = app.request("/v1/materials", { method: "POST", headers, body: form });

    let sawDigesting = false;
    for (let i = 0; i < 50; i++) {
      const listRes = await app.request(`/v1/materials?subjectId=${subject.id}`, { headers });
      expect(listRes.status).toBe(200);
      const list = await readJson<Array<{ status: string }>>(listRes);
      if (list.some((m) => m.status === "digesting")) {
        sawDigesting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(sawDigesting).toBe(true);

    release();
    expect((await uploadPromise).status).toBe(201);
  });
  /**
   * HUECO ENCONTRADO POR MUTACIÓN (arquitecto, 2026-08-02): hay DOS guardias de
   * duplicado, una por camino de subida. Mutar la del camino `full` tiraba dos
   * tests; mutar la de `subset` **dejaba los 354 en verde**.
   *
   * Y `subset` es el camino MÁS usado: el cliente móvil lo elige para todo PDF
   * por debajo de 3 MB (`shouldSkipWebViewParse`), o sea el caso común. La
   * guardia sin cubrir era la de la mayoría de las subidas reales.
   */
  it("mismo clientUploadId dos veces en subset → un material y un solo cobro", async () => {
    const { app, headers, subject, userId } = await setup();
    generateTextMock.mockResolvedValue({ text: "# Página cloud", usage: usageOf() });

    const bytes = new Uint8Array(await readFile(GUIA_VA3_PATH));
    const onePage = await extractSinglePagePdf(bytes, 1);

    function subsetForm(): FormData {
      const form = new FormData();
      form.set("subjectId", subject.id);
      form.set("mode", "subset");
      form.set("totalPages", "1");
      form.set("pages", JSON.stringify([{ pageNumber: 1, claimedTier: "cloud", localText: null }]));
      form.set("originalFilename", "guiaVA3.pdf");
      form.set("clientUploadId", "cu-subset-1");
      form.set("cloudPage-1", new File([new Uint8Array(onePage)], "page-1.pdf", { type: "application/pdf" }));
      return form;
    }

    const res1 = await app.request("/v1/materials", { method: "POST", headers, body: subsetForm() });
    expect(res1.status).toBe(201);
    const first = await readJson<{ id: string }>(res1);
    const chargesAfterFirst = generateTextMock.mock.calls.length;
    expect(chargesAfterFirst).toBeGreaterThan(0);

    const res2 = await app.request("/v1/materials", { method: "POST", headers, body: subsetForm() });
    expect(res2.status).toBe(409);
    expect((await readJson<{ code: string }>(res2)).code).toBe("duplicate_material");
    // Invariante central: el reintento NO vuelve a cobrar.
    expect(generateTextMock).toHaveBeenCalledTimes(chargesAfterFirst);

    const pdfs = (await listMaterialsBySubject(ctx.deps.db, userId, subject.id)).filter((m) => m.kind === "pdf");
    expect(pdfs).toHaveLength(1);
    expect(pdfs[0]!.id).toBe(first.id);
  });

});

describe("beginMaterialDigest — orphan reclaim + stale list flip", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("reclaims a digesting orphan older than MATERIAL_DIGEST_ORPHAN_MS", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "orphan-reclaim@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", {
        method: "POST",
        headers,
        body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }),
      }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", {
        method: "POST",
        headers,
        body: JSON.stringify({ courseId: course.id, name: "Física" }),
      }),
    );

    const firstNow = new Date("2026-08-02T12:00:00.000Z");
    const first = await beginMaterialDigest(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      kind: "pdf",
      originalFilename: "a.pdf",
      digestionPipelineVersion: "test-v1",
      clientUploadId: "cu-orphan",
      now: firstNow,
    });
    expect(first.kind).toBe("acquired");

    const later = new Date(firstNow.getTime() + MATERIAL_DIGEST_ORPHAN_MS + 1_000);
    const reclaim = await beginMaterialDigest(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      kind: "pdf",
      originalFilename: "a.pdf",
      digestionPipelineVersion: "test-v1",
      clientUploadId: "cu-orphan",
      now: later,
    });
    expect(reclaim.kind).toBe("acquired");
    expect(reclaim.material.id).toBe(first.material.id);
  });

  it("listMaterialsBySubject flips stale digesting → failed", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "stale-list@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", {
        method: "POST",
        headers,
        body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }),
      }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", {
        method: "POST",
        headers,
        body: JSON.stringify({ courseId: course.id, name: "Química" }),
      }),
    );

    const now = new Date("2026-08-02T18:00:00.000Z");
    const claim = await beginMaterialDigest(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      kind: "pdf",
      originalFilename: "zombie.pdf",
      digestionPipelineVersion: "test-v1",
      clientUploadId: "cu-zombie",
      now,
    });
    expect(claim.kind).toBe("acquired");

    const staleAt = new Date(now.getTime() - MATERIAL_DIGEST_ORPHAN_MS - 5_000).toISOString();
    await setMaterialCreatedAtForTests(ctx.deps.db, claim.material.id, staleAt);

    const list = await listMaterialsBySubject(ctx.deps.db, userId, subject.id, now);
    const row = list.find((m) => m.id === claim.material.id);
    expect(row?.status).toBe("failed");
  });

  it("fresh digesting duplicate is NOT reclaimed", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "fresh-dup@example.com");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", {
        method: "POST",
        headers,
        body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }),
      }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", {
        method: "POST",
        headers,
        body: JSON.stringify({ courseId: course.id, name: "Historia" }),
      }),
    );

    const now = new Date("2026-08-02T12:00:00.000Z");
    const first = await beginMaterialDigest(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      kind: "pdf",
      originalFilename: "a.pdf",
      digestionPipelineVersion: "test-v1",
      clientUploadId: "cu-fresh",
      now,
    });
    const dup = await beginMaterialDigest(ctx.deps.db, {
      userId,
      subjectId: subject.id,
      kind: "pdf",
      originalFilename: "a.pdf",
      digestionPipelineVersion: "test-v1",
      clientUploadId: "cu-fresh",
      now: new Date(now.getTime() + 60_000),
    });
    expect(first.kind).toBe("acquired");
    expect(dup.kind).toBe("duplicate");
    expect(dup.material.id).toBe(first.material.id);
  });
});

describe("POST /v1/materials — paste/photo clientUploadId (E15)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setup() {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const email = `paste-idem-${Math.random().toString(36).slice(2)}@example.com`;
    const { token, userId } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", {
        method: "POST",
        headers,
        body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }),
      }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", {
        method: "POST",
        headers,
        body: JSON.stringify({ courseId: course.id, name: "Matemática" }),
      }),
    );
    return { app, headers, userId, subject };
  }

  it("same paste clientUploadId twice → 201 then 409, one row", async () => {
    const { app, headers, userId, subject } = await setup();
    const body = {
      kind: "paste",
      subjectId: subject.id,
      text: "La derivada de x^2 es 2x.",
      clientUploadId: "cu-paste-1",
    };
    const res1 = await app.request("/v1/materials", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(res1.status).toBe(201);
    const first = await readJson<{ id: string; status: string }>(res1);
    expect(first.status).toBe("ready");

    const res2 = await app.request("/v1/materials", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(res2.status).toBe(409);
    expect((await readJson<{ code: string }>(res2)).code).toBe("duplicate_material");

    const list = await listMaterialsBySubject(ctx.deps.db, userId, subject.id);
    expect(list.filter((m) => m.kind === "paste")).toHaveLength(1);
  });

  it("paste without clientUploadId keeps pre-idempotency behaviour (two rows)", async () => {
    const { app, headers, userId, subject } = await setup();
    for (let i = 0; i < 2; i++) {
      const res = await app.request("/v1/materials", {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "paste", subjectId: subject.id, text: "mismo texto" }),
      });
      expect(res.status).toBe(201);
    }
    const list = await listMaterialsBySubject(ctx.deps.db, userId, subject.id);
    expect(list.filter((m) => m.kind === "paste")).toHaveLength(2);
  });

  it("same photo clientUploadId twice → 201 then 409, one pending row", async () => {
    const { app, headers, userId, subject } = await setup();
    const auth = { authorization: headers.authorization };

    const form1 = new FormData();
    form1.set("subjectId", subject.id);
    form1.set("clientUploadId", "cu-photo-1");
    form1.set("file", new File([new Uint8Array([1, 2, 3])], "notes.png", { type: "image/png" }));
    const res1 = await app.request("/v1/materials", { method: "POST", headers: auth, body: form1 });
    expect(res1.status).toBe(201);
    expect((await readJson<{ kind: string; status: string }>(res1)).kind).toBe("photo");

    const form2 = new FormData();
    form2.set("subjectId", subject.id);
    form2.set("clientUploadId", "cu-photo-1");
    form2.set("file", new File([new Uint8Array([1, 2, 3])], "notes.png", { type: "image/png" }));
    const res2 = await app.request("/v1/materials", { method: "POST", headers: auth, body: form2 });
    expect(res2.status).toBe(409);
    expect((await readJson<{ code: string }>(res2)).code).toBe("duplicate_material");

    const list = await listMaterialsBySubject(ctx.deps.db, userId, subject.id);
    expect(list.filter((m) => m.kind === "photo")).toHaveLength(1);
  });
});
