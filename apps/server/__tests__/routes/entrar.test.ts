import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import type { RecordingEmailSender } from "../../src/auth/email";
import { escapeHtml, escapeJsString } from "../../src/routes/entrar";
import { readJson } from "../support/json";

describe("GET /entrar — HTTPS trampoline to buxo://login", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("with a valid token returns 200 HTML containing buxo://login?token=…", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const token = "abc_DEF-0123456789";
    const res = await app.request(`/entrar?token=${token}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");

    const html = await res.text();
    expect(html).toContain(`buxo://login?token=${token}`);
    expect(html).toContain("Abrir Socrates");
    expect(html).toContain("Si no se abrió sola");
  });

  it("without token returns 200 error page and no buxo:// scheme", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const res = await app.request("/entrar");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("buxo://");
    expect(html).toMatch(/enlace incompleto|código de acceso/i);
  });

  it("rejects tokens outside [A-Za-z0-9_-] without reflecting them", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const dirty = "abc.def+ghi";
    const res = await app.request(`/entrar?token=${encodeURIComponent(dirty)}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain(dirty);
    expect(html).not.toContain("buxo://");
  });

  it("does not reflect raw injection payloads (quotes / script tags)", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const payloads = ['"><script>alert(1)</script>', "';onclick=alert(1)//", "<img src=x onerror=alert(1)>"];
    for (const payload of payloads) {
      const res = await app.request(`/entrar?token=${encodeURIComponent(payload)}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain(payload);
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("onclick=alert");
      expect(html).not.toContain("onerror=alert");
      expect(html).not.toContain("buxo://");
    }
  });

  it("does not consume the magic-link token — verify still works after visiting /entrar", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "trampoline@example.com",
        ageConfirmedAt: new Date().toISOString(),
        consents: [
          { type: "terms_13plus", policyVersion: "v1" },
          { type: "privacy_policy", policyVersion: "v1" },
        ],
      }),
    });

    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    const link = emailSender.lastLinkFor("trampoline@example.com")!;
    const token = new URL(link).searchParams.get("token")!;
    expect(token).toBeTruthy();

    const trampoline = await app.request(`/entrar?token=${encodeURIComponent(token)}`);
    expect(trampoline.status).toBe(200);
    const html = await trampoline.text();
    expect(html).toContain(`buxo://login?token=${token}`);

    const verifyRes = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(verifyRes.status).toBe(200);
    const body = await readJson<{ userId: string; token: string }>(verifyRes);
    expect(body.userId).toBeTruthy();
    expect(typeof body.token).toBe("string");
  });

  it("is public — no Authorization header required", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const res = await app.request("/entrar?token=publicToken123");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("buxo://login?token=publicToken123");
  });
});

describe("entrar escape helpers (fail if escaping is removed)", () => {
  it("escapeHtml neutralizes quotes and angle brackets", () => {
    expect(escapeHtml('"><script>x</script>')).toBe("&quot;&gt;&lt;script&gt;x&lt;/script&gt;");
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });

  it("escapeJsString neutralizes quotes, backslashes, and </script>", () => {
    expect(escapeJsString('foo"bar')).toBe('foo\\"bar');
    expect(escapeJsString("a\\b")).toBe("a\\\\b");
    expect(escapeJsString("</script>")).toBe("\\u003c/script>");
  });
});
