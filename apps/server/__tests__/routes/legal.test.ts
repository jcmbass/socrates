import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { CONTACT_EMAIL } from "../../src/legal/documents";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@buxo/domain/policy-versions";

describe("GET /legal/* — public documents, no auth", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function app() {
    ctx = await buildTestDeps();
    return createApp(ctx.deps);
  }

  it("GET /legal/terminos is 200 HTML with the current terms version and cubo.lat as operator", async () => {
    const res = await (await app()).request("/legal/terminos");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain(CURRENT_TERMS_VERSION);
    expect(html).toContain("terms-2026-09-v2");
    expect(html).toContain("cubo.lat");
    expect(html).toContain(CONTACT_EMAIL);
    expect(html).toContain("Eliminar mi cuenta");
    expect(html).toContain("cubo.lat");
    expect(html).not.toContain("Razon Social");
    expect(html).not.toContain("sociedad mercantil");
  });

  it("GET /legal/privacidad attributes gemma/DeepSeek/Qwen correctly and names cubo.lat", async () => {
    const res = await (await app()).request("/legal/privacidad");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(CURRENT_PRIVACY_VERSION);
    expect(html).toContain("privacy-2026-09-v4");
    expect(html).toContain("cubo.lat");
    expect(html).toContain("gemma (Google)");
    expect(html).toContain("DeepSeek (DeepSeek)");
    expect(html).toContain("Qwen (Alibaba)");
    expect(html).not.toContain("modelos de Google (gemma, Qwen)");
    expect(html).toContain("Eliminar mi cuenta");
  });

  it("GET /legal/eliminar-cuenta explains in-app + email deletion without reinstall", async () => {
    const res = await (await app()).request("/legal/eliminar-cuenta");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain(CONTACT_EMAIL);
    expect(html).toContain("Eliminar mi cuenta");
    expect(html).toMatch(/seudonimiza/i);
    expect(html).toMatch(/reinstalar/i);
    expect(html).toContain("Tu progreso de estudio");
    expect(html).toContain("Tus fuentes de estudio");
  });
});
