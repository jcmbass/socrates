/**
 * beta-real 07 B.1 — RasterPageTooLargeError must map to its own API code,
 * not the generic 500 path.
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
import { RasterPageTooLargeError } from "../../src/raster/rasterizer";
import type { CourseBody, SubjectBody } from "../support/http-types";

const GUIA1_PATH = new URL("../../../../docs/guia1.pdf", import.meta.url);

describe("POST /v1/materials — RasterPageTooLargeError mapping (beta-real 07)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  beforeEach(async () => {
    generateTextMock.mockReset();
  });

  it("returns code raster_page_too_large naming the page (not a generic 500)", async () => {
    const stubRasterizer = {
      rasterizePage: async () => {
        throw new RasterPageTooLargeError(7, 9_000_000, 4_000_000);
      },
    };
    ctx = await buildTestDeps({ rasterizer: stubRasterizer });
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, `raster-map-${Date.now()}@example.com`);

    const courseRes = await app.request("/v1/courses", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "C", gradeLevelId: "sv-universidad-1" }),
    });
    const course = await readJson<CourseBody>(courseRes);
    const subjectRes = await app.request("/v1/subjects", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ courseId: course.id, name: "Materia" }),
    });
    const subject = await readJson<SubjectBody>(subjectRes);

    // guia1 page 1 is cloud-tier — pipeline will call the rasterizer.
    const guia1Bytes = new Uint8Array(await readFile(GUIA1_PATH));
    const page1 = await extractSinglePagePdf(guia1Bytes, 1);

    const form = new FormData();
    form.set("subjectId", subject.id);
    form.set("mode", "subset");
    form.set("totalPages", "1");
    form.set("pages", JSON.stringify([{ pageNumber: 1, claimedTier: "cloud", localText: null }]));
    form.set("cloudPage-1", new File([new Uint8Array(page1)], "page-1.pdf", { type: "application/pdf" }));

    const res = await app.request("/v1/materials", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    expect(res.status).toBe(400);
    const body = await readJson<{ code: string; error: string }>(res);
    expect(body.code).toBe("raster_page_too_large");
    expect(body.error).toMatch(/page 7/i);
  });
});
