/**
 * A3a — PATCH /v1/me + idioma de signup/login.
 *
 * Contrato que el cliente ya tipó en A1 (`updatePreferredLanguage`,
 * `lib/preferredLanguageSync.ts`): PATCH /v1/me
 * `{ preferredLanguageCode: "es" | "en" }` → 204 sin cuerpo. Antes de A3a
 * cada request daba 404 y el sync del cliente era un no-op cortés.
 *
 * Precedencia de idioma para signup (acordada con el arquitecto):
 * body > Accept-Language ("en*"→"en", resto→"es") > default "es".
 * Para login/recover de usuario existente manda la locale persistida.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import type { RecordingEmailSender } from "../../src/auth/email";
import { buildMagicLinkEmailContent } from "../../src/auth/email";
import { findUserById } from "../../src/repositories/users";
import { CRISIS_REPLY_EN } from "../../src/safety/templates";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody, SessionBody } from "../support/http-types";

describe("PATCH /v1/me — preferredLanguageCode (A3a)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function signupWith(app: ReturnType<typeof createApp>, email: string, headers: Record<string, string> = {}) {
    const res = await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        email,
        ageConfirmedAt: new Date().toISOString(),
        consents: [
          { type: "terms_13plus", policyVersion: "v1" },
          { type: "privacy_policy", policyVersion: "v1" },
        ],
      }),
    });
    expect(res.status).toBe(202);
    return res;
  }

  it("happy path 'en': 204, persists the locale, second write idempotent", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "me-en@example.com");

    const res = await app.request("/v1/me", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ preferredLanguageCode: "en" }),
    });
    expect(res.status).toBe(204);
    expect((await findUserById(ctx.deps.db, userId))?.preferredLanguageCode).toBe("en");

    // Repite el mismo valor (el cliente puede re-sincronizar al arrancar) —
    // idempotente: mismo 204, mismo estado.
    const again = await app.request("/v1/me", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ preferredLanguageCode: "en" }),
    });
    expect(again.status).toBe(204);
    expect((await findUserById(ctx.deps.db, userId))?.preferredLanguageCode).toBe("en");

    // Cambio de vuelta a "es" también funciona.
    const back = await app.request("/v1/me", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ preferredLanguageCode: "es" }),
    });
    expect(back.status).toBe(204);
    expect((await findUserById(ctx.deps.db, userId))?.preferredLanguageCode).toBe("es");
  });

  it("400 on an unsupported locale", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "me-bad@example.com");

    const res = await app.request("/v1/me", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ preferredLanguageCode: "fr" }),
    });
    expect(res.status).toBe(400);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("invalid_request");
    // Nada se escribió.
    const user = await findUserById(ctx.deps.db, userId);
    expect(user?.preferredLanguageCode).toBe("es");
  });

  it("400 on a malformed body", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "me-malformed@example.com");

    const res = await app.request("/v1/me", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("invalid_request");
  });

  it("401 without a bearer token", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const res = await app.request("/v1/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferredLanguageCode: "en" }),
    });
    expect(res.status).toBe(401);
  });

  it("signup: Accept-Language 'en' drives account locale AND email language", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    await signupWith(app, "al-en@example.com", { "accept-language": "en-US,en;q=0.9" });
    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    const sent = emailSender.sent[0];
    expect(sent.locale).toBe("en");

    // El contenido construido desde el email registrado es inglés.
    const content = buildMagicLinkEmailContent(sent);
    expect(content.subject).toBe("Confirm your Socrates account");
    expect(content.text).toContain("minutes"); // ttl del env de test = 20 minutes
    expect(content.html).toContain('lang="en"');
  });

  it("signup: body preferredLanguageCode beats Accept-Language", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const res = await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": "en" },
      body: JSON.stringify({
        email: "body-beats@example.com",
        preferredLanguageCode: "es",
        ageConfirmedAt: new Date().toISOString(),
        consents: [
          { type: "terms_13plus", policyVersion: "v1" },
          { type: "privacy_policy", policyVersion: "v1" },
        ],
      }),
    });
    expect(res.status).toBe(202);
    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    expect(emailSender.sent[0].locale).toBe("es");
  });

  it("signup: no header, no body → 'es' (no-regresión con el comportamiento pre-A3a)", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    await signupWith(app, "default-es@example.com");
    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    const sent = emailSender.sent[0];
    expect(sent.locale).toBe("es");

    const content = buildMagicLinkEmailContent(sent);
    expect(content.subject).toBe("Confirmá tu cuenta en Socrates");
    expect(content.html).toContain('lang="es"');
    expect(content.text).toContain("Expira en");
  });

  it("signup: a non-en Accept-Language ('fr') falls back to 'es'", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    await signupWith(app, "al-fr@example.com", { "accept-language": "fr-FR,fr;q=0.9" });
    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    expect(emailSender.sent[0].locale).toBe("es");
  });

  it("signup with Accept-Language 'en' persists preferredLanguageCode 'en' on verify", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    await signupWith(app, "persist-en@example.com", { "accept-language": "en" });
    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    const link = emailSender.lastLinkFor("persist-en@example.com");
    const token = new URL(link!).searchParams.get("token")!;
    const verifyRes = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(verifyRes.status).toBe(200);
    const { userId } = await readJson<{ userId: string }>(verifyRes);
    const user = await findUserById(ctx.deps.db, userId);
    expect(user?.preferredLanguageCode).toBe("en");
  });

  it("login: existing user's stored locale decides the email language", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, "login-en@example.com");

    // El usuario elige inglés después de crear la cuenta.
    await app.request("/v1/me", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ preferredLanguageCode: "en" }),
    });

    await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "login-en@example.com" }),
    });
    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    expect(emailSender.sent[emailSender.sent.length - 1]).toMatchObject({
      purpose: "login",
      locale: "en",
    });
  });

  it("safety reply follows the synced locale (English end-to-end, same resources)", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const { token, userId } = await signupAndVerify(app, ctx.deps, "safety-en@example.com");
    await app.request("/v1/me", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ preferredLanguageCode: "en" }),
    });
    expect((await findUserById(ctx.deps.db, userId))?.preferredLanguageCode).toBe("en");

    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", { method: "POST", headers, body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }) }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", { method: "POST", headers, body: JSON.stringify({ courseId: course.id, name: "Cálculo" }) }),
    );
    const session = await readJson<SessionBody>(
      await app.request("/v1/sessions", { method: "POST", headers, body: JSON.stringify({ subjectId: subject.id }) }),
    );

    const res = await app.request(`/v1/sessions/${session.id}/exchanges`, {
      method: "POST",
      headers,
      body: JSON.stringify({ studentMessage: "ya no quiero seguir viviendo" }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(CRISIS_REPLY_EN);
  });
});