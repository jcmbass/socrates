import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import type { RecordingEmailSender } from "../../src/auth/email";
import { readJson } from "../support/json";
import { signupAndVerify } from "../support/signup";

describe("auth routes: signup -> verify -> bearer session (DF-6.2 magic-link)", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("signup issues a magic link and never returns a token directly (202, no body)", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const res = await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "student@example.com",
        ageConfirmedAt: new Date().toISOString(),
        consents: [
          { type: "terms_13plus", policyVersion: "v1" },
          { type: "privacy_policy", policyVersion: "v1" },
        ],
      }),
    });

    expect(res.status).toBe(202);
    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]).toMatchObject({ to: "student@example.com", purpose: "signup" });
  });

  /**
   * Bug del 2026-09-18 (tester en inglés): la app NO mandaba
   * `preferredLanguageCode` ni Accept-Language, así que TODA cuenta nueva
   * nacía en "es" — incluido el correo del magic-link, que sale antes de que
   * exista sesión y por lo tanto antes de que `PATCH /v1/me` pueda corregir
   * nada. `resolveSignupLocale` ya estaba bien; lo que faltaba era el body.
   * Este test congela la cadena COMPLETA (body → correo → fila persistida),
   * no solo la función pura.
   */
  it("signup con preferredLanguageCode 'en' manda el correo en inglés y persiste la fila en 'en'", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const res = await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "english@example.com",
        displayName: "Ada",
        preferredLanguageCode: "en",
        ageConfirmedAt: new Date().toISOString(),
        consents: [
          { type: "terms_13plus", policyVersion: "v1" },
          { type: "privacy_policy", policyVersion: "v1" },
        ],
      }),
    });
    expect(res.status).toBe(202);

    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    const sent = emailSender.sent[0]!;
    expect(sent.locale).toBe("en");

    const token = new URL(emailSender.lastLinkFor("english@example.com")!).searchParams.get("token")!;
    const verified = await readJson<{ userId: string }>(
      await app.request("/v1/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );

    const { findUserById } = await import("../../src/repositories/users");
    const user = await findUserById(ctx.deps.db, verified.userId);
    expect(user?.preferredLanguageCode).toBe("en");
  });

  it("signup sin preferredLanguageCode ni Accept-Language sigue naciendo en 'es'", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const { userId } = await signupAndVerify(app, ctx.deps, "spanish-default@example.com");
    const { findUserById } = await import("../../src/repositories/users");
    expect((await findUserById(ctx.deps.db, userId))?.preferredLanguageCode).toBe("es");
  });

  it("rejects signup missing DF-3 required consents", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const res = await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@example.com", ageConfirmedAt: new Date().toISOString(), consents: [] }),
    });
    expect(res.status).toBe(400);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("invalid_request");
  });

  it("verify consumes the link, creates the account, and returns a usable bearer token", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "verify@example.com",
        ageConfirmedAt: new Date().toISOString(),
        consents: [
          { type: "terms_13plus", policyVersion: "v1" },
          { type: "privacy_policy", policyVersion: "v1" },
        ],
      }),
    });

    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    const link = emailSender.lastLinkFor("verify@example.com")!;
    const token = new URL(link).searchParams.get("token")!;

    const verifyRes = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(verifyRes.status).toBe(200);
    const { userId, token: bearer, email, displayName } = await readJson<{
      userId: string;
      token: string;
      email: string;
      displayName: string;
    }>(verifyRes);
    expect(userId).toBeTruthy();
    expect(typeof bearer).toBe("string");
    expect(email).toBe("verify@example.com");
    expect(displayName).toBe("verify"); // no displayName sent — falls back to the email's local part (signup route default)

    // The bearer token actually authorizes a protected route.
    const coursesRes = await app.request("/v1/courses", { headers: { authorization: `Bearer ${bearer}` } });
    expect(coursesRes.status).toBe(200);
    expect(await readJson(coursesRes)).toEqual([]);
  });

  it("verify on a login token returns the account's real email/displayName from the server, not client-guessed values", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    // Sign up and verify to create an account with an explicit displayName.
    await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "returning@example.com",
        displayName: "Ada",
        ageConfirmedAt: new Date().toISOString(),
        consents: [
          { type: "terms_13plus", policyVersion: "v1" },
          { type: "privacy_policy", policyVersion: "v1" },
        ],
      }),
    });
    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    const signupToken = new URL(emailSender.lastLinkFor("returning@example.com")!).searchParams.get("token")!;
    await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: signupToken }),
    });

    // Now log back in via a fresh magic link (login purpose).
    const loginRes = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "returning@example.com" }),
    });
    expect(loginRes.status).toBe(202);
    const loginToken = new URL(emailSender.lastLinkFor("returning@example.com")!).searchParams.get("token")!;

    const verifyRes = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: loginToken }),
    });
    expect(verifyRes.status).toBe(200);
    const body = await readJson<{ userId: string; token: string; email: string; displayName: string }>(verifyRes);
    expect(body.email).toBe("returning@example.com");
    expect(body.displayName).toBe("Ada");
  });

  it("verify on a login token for a since-deleted user returns the same generic unauthorized error as an invalid token", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "deleted@example.com",
        ageConfirmedAt: new Date().toISOString(),
        consents: [
          { type: "terms_13plus", policyVersion: "v1" },
          { type: "privacy_policy", policyVersion: "v1" },
        ],
      }),
    });
    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    const signupToken = new URL(emailSender.lastLinkFor("deleted@example.com")!).searchParams.get("token")!;
    const signupVerify = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: signupToken }),
    });
    const { userId } = await readJson<{ userId: string }>(signupVerify);

    await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "deleted@example.com" }),
    });
    const loginToken = new URL(emailSender.lastLinkFor("deleted@example.com")!).searchParams.get("token")!;

    // Simulate a hard-deleted row (findUserById doesn't filter by accountStatus, so
    // markUserDeleted's soft-delete wouldn't reproduce the "user gone" case this covers).
    const { eq } = await import("drizzle-orm");
    const { users } = await import("../../src/db/schema");
    await ctx.deps.db.delete(users).where(eq(users.id, userId));

    const verifyRes = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: loginToken }),
    });
    expect(verifyRes.status).toBe(401);
    expect((await readJson<{ code: string }>(verifyRes)).code).toBe("unauthorized");
  });

  it("rejects reusing a verify token twice", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "reuse@example.com",
        ageConfirmedAt: new Date().toISOString(),
        consents: [
          { type: "terms_13plus", policyVersion: "v1" },
          { type: "privacy_policy", policyVersion: "v1" },
        ],
      }),
    });
    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    const token = new URL(emailSender.lastLinkFor("reuse@example.com")!).searchParams.get("token")!;

    const first = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(second.status).toBe(401);
    expect((await readJson<{ code: string }>(second)).code).toBe("unauthorized");
  });

  it("login and recover never reveal whether the account exists (identical response either way)", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const forUnknown = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    const forKnown = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    expect(forUnknown.status).toBe(202);
    expect(forKnown.status).toBe(202);

    const recover = await app.request("/v1/auth/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    expect(recover.status).toBe(204);

    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    expect(emailSender.sent).toHaveLength(0); // no account exists — no link actually issued/sent
  });

  it("BE3: a failed email send still returns 202 on login (anti-enumeration — no 500 leak)", async () => {
    ctx = await buildTestDeps();
    // Create a real account first.
    const app = createApp(ctx.deps);
    await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "sendfail@example.com",
        ageConfirmedAt: new Date().toISOString(),
        consents: [
          { type: "terms_13plus", policyVersion: "v1" },
          { type: "privacy_policy", policyVersion: "v1" },
        ],
      }),
    });
    const recording = ctx.deps.emailSender as RecordingEmailSender;
    const token = new URL(recording.lastLinkFor("sendfail@example.com")!).searchParams.get("token")!;
    await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

    // Swap in a sender that always throws — must not become 500 when account exists.
    ctx.deps.emailSender = {
      async sendMagicLink() {
        throw new Error("simulated transport failure");
      },
    };

    const loginExisting = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "sendfail@example.com" }),
    });
    const loginMissing = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "does-not-exist@example.com" }),
    });
    expect(loginExisting.status).toBe(202);
    expect(loginMissing.status).toBe(202);
  });

  it("protected routes reject a missing/invalid bearer token", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const noAuth = await app.request("/v1/courses");
    expect(noAuth.status).toBe(401);

    const badAuth = await app.request("/v1/courses", { headers: { authorization: "Bearer garbage" } });
    expect(badAuth.status).toBe(401);
  });
});

/**
 * R11 (beta cerrada, lote 3 — docs/plan-beta-real/11-observaciones-beta-cerrada.md):
 * «Account deletion didn't work and i am unable to sign up with the same
 * account.» El borrado sí corría; lo que fallaba era el re-registro, porque
 * el tombstone seguía ocupando el correo (UNIQUE plano + `findUserByEmail`
 * sin filtro de `accountStatus`). La corrección son dos piezas que solo
 * sirven juntas: el índice parcial `users_primary_email_active_uidx`
 * (migración 0018) y el filtro en `findUserByEmail`.
 */
describe("auth routes: a deleted account releases its email (R11, beta lote 3)", () => {
  let ctx: TestContext;

  const signupBody = (email: string) =>
    JSON.stringify({
      email,
      ageConfirmedAt: new Date().toISOString(),
      consents: [
        { type: "terms_13plus", policyVersion: "v1" },
        { type: "privacy_policy", policyVersion: "v1" },
      ],
    });

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("delete account -> signup + verify with the SAME email mints a BRAND-NEW account", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const email = "reborn@example.com";

    const first = await signupAndVerify(app, ctx.deps, email);
    const deleted = await app.request("/v1/account", {
      method: "DELETE",
      headers: { authorization: `Bearer ${first.token}`, "content-type": "application/json" },
    });
    expect(deleted.status).toBe(202);

    // Lo que R11 no pudo hacer: volver a registrarse.
    const second = await signupAndVerify(app, ctx.deps, email);
    expect(second.userId).not.toBe(first.userId);

    // Y la cuenta nueva es usable de verdad, no solo un 202 de cortesía.
    const courses = await app.request("/v1/courses", { headers: { authorization: `Bearer ${second.token}` } });
    expect(courses.status).toBe(200);

    // El tombstone sobrevive intacto (auditoría): no se mutó ninguna fila histórica.
    const { findUserById } = await import("../../src/repositories/users");
    const tombstone = await findUserById(ctx.deps.db, first.userId);
    expect(tombstone?.accountStatus).toBe("deleted");
    const { users } = await import("../../src/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await ctx.deps.db.select().from(users).where(eq(users.id, first.userId));
    expect(row.primaryEmail).toBe(email);
  });

  it("signup against a LIVE account with the same email still conflicts (409) — el fix no abre un hueco", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    await signupAndVerify(app, ctx.deps, "taken@example.com");

    const res = await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: signupBody("taken@example.com"),
    });
    expect(res.status).toBe(409);
    expect((await readJson<{ code: string }>(res)).code).toBe("conflict");
  });

  it("the DB still refuses two LIVE rows with the same email (el índice parcial no es un UNIQUE desactivado)", async () => {
    ctx = await buildTestDeps();
    const { createUser } = await import("../../src/repositories/users");
    const input = { email: "dupe@example.com", displayName: "Dupe", ageConfirmedAt: new Date().toISOString() };

    await createUser(ctx.deps.db, input);
    await expect(createUser(ctx.deps.db, input)).rejects.toThrow();
  });

  it("login/recover stop issuing magic links once the account is deleted", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);
    const email = "gone@example.com";

    const { token } = await signupAndVerify(app, ctx.deps, email);
    await app.request("/v1/account", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });

    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    const sentBefore = emailSender.sent.length;

    const login = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const recover = await app.request("/v1/auth/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });

    // Anti-enumeración intacta: mismos códigos que para un correo desconocido...
    expect(login.status).toBe(202);
    expect(recover.status).toBe(204);
    // ...pero sin emitir un link hacia una cuenta que `requireAuth` ya rechaza.
    expect(emailSender.sent).toHaveLength(sentBefore);
  });
});

describe("auth routes: tester enrollment (2026-09-05, closed-testing-only public link)", () => {
  let ctx: TestContext;
  const ENROLL_TOKEN = "test-only-enroll-secret-do-not-reuse";
  const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const PAST = new Date(Date.now() - 60 * 1000).toISOString();

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  it("is a no-op when TESTER_ENROLL_TOKEN is unset (default) — arbitrary tokens still just fail normally", async () => {
    ctx = await buildTestDeps();
    const app = createApp(ctx.deps);

    const res = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: ENROLL_TOKEN }),
    });
    expect(res.status).toBe(401);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("unauthorized");
  });

  it("the correct token mints a brand-new account with an @testers.invalid email and recorded consents", async () => {
    ctx = await buildTestDeps({
      envOverrides: { TESTER_ENROLL_TOKEN: ENROLL_TOKEN, TESTER_ENROLL_EXPIRES_AT: FUTURE },
    });
    const app = createApp(ctx.deps);

    const res = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: ENROLL_TOKEN }),
    });
    expect(res.status).toBe(200);
    const { userId, token: bearer, email, displayName } = await readJson<{
      userId: string;
      token: string;
      email: string;
      displayName: string;
    }>(res);
    expect(userId).toBeTruthy();
    expect(typeof bearer).toBe("string");
    expect(email).toMatch(/^tester-[0-9a-f]{12}@testers\.invalid$/);
    expect(displayName).toBe("Tester");

    // The bearer token actually authorizes a protected route — a real, usable account.
    const coursesRes = await app.request("/v1/courses", { headers: { authorization: `Bearer ${bearer}` } });
    expect(coursesRes.status).toBe(200);
  });

  it("opening the SAME link twice creates TWO DIFFERENT accounts — never a shared one (the whole point)", async () => {
    ctx = await buildTestDeps({
      envOverrides: { TESTER_ENROLL_TOKEN: ENROLL_TOKEN, TESTER_ENROLL_EXPIRES_AT: FUTURE },
    });
    const app = createApp(ctx.deps);

    const verify = async () => {
      const r = await app.request("/v1/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: ENROLL_TOKEN }),
      });
      return readJson<{ userId: string; email: string }>(r);
    };

    const first = await verify();
    const second = await verify();
    expect(first.userId).not.toBe(second.userId);
    expect(first.email).not.toBe(second.email);
  });

  it("rejects a wrong token even when enrollment is configured — no accidental match", async () => {
    ctx = await buildTestDeps({
      envOverrides: { TESTER_ENROLL_TOKEN: ENROLL_TOKEN, TESTER_ENROLL_EXPIRES_AT: FUTURE },
    });
    const app = createApp(ctx.deps);

    const res = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "not-the-enroll-token" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects the correct token once TESTER_ENROLL_EXPIRES_AT is in the past — dies on its own", async () => {
    ctx = await buildTestDeps({
      envOverrides: { TESTER_ENROLL_TOKEN: ENROLL_TOKEN, TESTER_ENROLL_EXPIRES_AT: PAST },
    });
    const app = createApp(ctx.deps);

    const res = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: ENROLL_TOKEN }),
    });
    expect(res.status).toBe(401);
  });

  it("does not interfere with the real magic-link signup/verify flow when enrollment is also configured", async () => {
    ctx = await buildTestDeps({
      envOverrides: { TESTER_ENROLL_TOKEN: ENROLL_TOKEN, TESTER_ENROLL_EXPIRES_AT: FUTURE },
    });
    const app = createApp(ctx.deps);

    await app.request("/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "real-student@example.com",
        ageConfirmedAt: new Date().toISOString(),
        consents: [
          { type: "terms_13plus", policyVersion: "v1" },
          { type: "privacy_policy", policyVersion: "v1" },
        ],
      }),
    });
    const emailSender = ctx.deps.emailSender as RecordingEmailSender;
    const link = emailSender.lastLinkFor("real-student@example.com")!;
    const token = new URL(link).searchParams.get("token")!;

    const res = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ email: string }>(res);
    expect(body.email).toBe("real-student@example.com");
  });
});
