/**
 * Auth routes — C-backend §2.4's contract, ADAPTED to magic-link (DF-6.2)
 * instead of the spec's literal email+password shape. DEVIATION (flagged
 * for architect review): §2.4 literally reads
 *   `POST /v1/auth/login { email, password } → { token }`
 * DF-6.2 explicitly supersedes this ("auth self-hosted ... magic-link") and
 * the task brief names magic-link as the required mechanism — password
 * auth is never implemented. `/v1/auth/verify` is a NEW endpoint (not in
 * §2.4's literal list) needed to consume the link/token and mint a bearer
 * session; without it, "magic-link" has no way to actually complete.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { CONSENT_TYPES } from "@buxo/domain/consent";
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from "@buxo/domain/policy-versions";
import type { AppDeps } from "../deps";
import { errorResponse } from "../errors";
import { issueMagicLink, verifyMagicLink, type SignupPayload } from "../auth/magic-link";
import type { MagicLinkEmail } from "../auth/email";
import { issueSessionToken } from "../auth/session";
import { createUser, findUserByEmail, findUserById } from "../repositories/users";
import { acceptConsent } from "../repositories/consents";
import { localeFromAcceptLanguage, normalizePreferredLanguageCode, resolveSignupLocale } from "../locale";
import type { SupportedLocale } from "../locale";

/**
 * Constant-time compare so response timing can't be used to brute-force
 * `TESTER_ENROLL_TOKEN` char-by-char. Different lengths never match, but the
 * length check itself leaks nothing actionable (the token is a fixed,
 * publicly-posted secret by design — see env.ts's docblock).
 */
function safeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Tester enrollment (2026-09-05, see env.ts's TESTER_ENROLL_TOKEN docblock):
 * one public link, any number of people, each open mints its OWN account —
 * never a shared one. Fully separate from magic_link_tokens/verifyMagicLink;
 * touches nothing about real-user auth. `@testers.invalid` is an RFC 2606
 * reserved TLD — guaranteed never a real, deliverable address.
 */
async function tryTesterEnrollment(
  deps: AppDeps,
  token: string,
): Promise<{ userId: string; displayName: string; email: string } | null> {
  const enrollToken = deps.env.TESTER_ENROLL_TOKEN;
  const expiresAt = deps.env.TESTER_ENROLL_EXPIRES_AT;
  if (!enrollToken || !expiresAt) return null;
  if (!safeTokenEquals(token, enrollToken)) return null;
  if (deps.now().getTime() >= new Date(expiresAt).getTime()) return null;

  const email = `tester-${randomBytes(6).toString("hex")}@testers.invalid`;
  const now = deps.now().toISOString();
  const user = await createUser(deps.db, {
    email,
    displayName: "Tester",
    ageConfirmedAt: now,
    /**
     * A3a: el tester entra por deep-link sin formulario, así que no hay
     * señal de idioma del cliente — recibe la locale default "es" y el
     * cliente la sincroniza después vía PATCH /v1/me al arrancar (momento
     * (c) de lib/preferredLanguageSync.ts). El repositorio ya aplica ese
     * default; se deja explícito aquí para documentar la decisión.
     */
    preferredLanguageCode: "es",
  });
  await acceptConsent(deps.db, { userId: user.id, type: "terms_13plus", policyVersion: CURRENT_TERMS_VERSION });
  await acceptConsent(deps.db, { userId: user.id, type: "privacy_policy", policyVersion: CURRENT_PRIVACY_VERSION });

  return { userId: user.id, displayName: user.displayName, email };
}

/**
 * BE3 decision (2026-08-02): if the transport fails, log server-side and
 * still return the same generic 202/204. A thrown send error on login would
 * otherwise become 500 only when the account exists — leaking enumeration.
 * Signup gets the same treatment so clients never branch on transport health.
 */
async function sendMagicLinkQuietly(deps: AppDeps, email: MagicLinkEmail): Promise<void> {
  try {
    await deps.emailSender.sendMagicLink(email);
  } catch (err: unknown) {
    console.error(
      `[auth] magic-link email failed (purpose=${email.purpose}):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * A3a — idioma del email de login/recover de un usuario EXISTENTE: su
 * `preferredLanguageCode` persistido manda (el cliente lo mantiene al día
 * con PATCH /v1/me); Accept-Language solo cubre la fila legacy con un valor
 * fuera del catálogo, y el default es "es" (idéntico al comportamiento
 * pre-A3a).
 */
function loginEmailLocale(
  stored: string,
  acceptLanguage: string | null | undefined,
): SupportedLocale {
  if (stored === "es" || stored === "en") return stored;
  return normalizePreferredLanguageCode(localeFromAcceptLanguage(acceptLanguage));
}

const SignupSchema = z.object({
  email: z.string().email(),
  ageConfirmedAt: z.iso.datetime(),
  consents: z
    .array(z.object({ type: z.enum(CONSENT_TYPES), policyVersion: z.string().min(1) }))
    .min(1),
  displayName: z.string().min(1).max(80).optional(),
  /**
   * A3a — locale elegida en la app, si el cliente la manda. Opcional y
   * acotada a lo que el producto soporta ("es"|"en"): cualquier otra cosa
   * cae a "es" vía `resolveSignupLocale` (body > Accept-Language > default).
   */
  preferredLanguageCode: z.enum(["es", "en"]).optional(),
});

const LoginSchema = z.object({ email: z.string().email() });
const RecoverSchema = z.object({ email: z.string().email() });
const VerifySchema = z.object({ token: z.string().min(1) });

const REQUIRED_SIGNUP_CONSENT_TYPES = ["terms_13plus", "privacy_policy"] as const;

export function createAuthRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/signup", async (c) => {
    const parsed = SignupSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);
    const body = parsed.data;

    const consentTypes = new Set(body.consents.map((x) => x.type));
    const missing = REQUIRED_SIGNUP_CONSENT_TYPES.filter((t) => !consentTypes.has(t));
    if (missing.length > 0) {
      return errorResponse(c, "invalid_request", `Missing required consent(s): ${missing.join(", ")} (DF-3)`);
    }

    const existing = await findUserByEmail(deps.db, body.email);
    if (existing) return errorResponse(c, "conflict", "An account with this email already exists");

    // A3a — idioma del correo y de la cuenta nueva: body > Accept-Language > "es".
    const locale = resolveSignupLocale(body.preferredLanguageCode, c.req.header("accept-language"));

    const payload: SignupPayload = {
      displayName: body.displayName ?? body.email.split("@")[0],
      ageConfirmedAt: body.ageConfirmedAt,
      consents: body.consents,
      preferredLanguageCode: locale,
    };

    const { token } = await issueMagicLink(deps.db, {
      email: body.email,
      purpose: "signup",
      payload,
      ttlMinutes: deps.env.MAGIC_LINK_TTL_MINUTES,
      now: deps.now(),
    });

    await sendMagicLinkQuietly(deps, {
      to: body.email,
      purpose: "signup",
      link: `${deps.env.MAGIC_LINK_BASE_URL}?token=${token}`,
      ttlMinutes: deps.env.MAGIC_LINK_TTL_MINUTES,
      locale,
    });

    return c.body(null, 202);
  });

  app.post("/login", async (c) => {
    const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);

    const user = await findUserByEmail(deps.db, parsed.data.email);
    if (user) {
      // A3a — login de usuario existente: manda lo que la cuenta ya guardó
      // (PATCH /v1/me del cliente lo mantiene al día); Accept-Language solo
      // entra como red de seguridad si la fila trae un valor no normalizado.
      const locale = loginEmailLocale(user.preferredLanguageCode, c.req.header("accept-language"));
      const { token } = await issueMagicLink(deps.db, {
        email: parsed.data.email,
        purpose: "login",
        userId: user.id,
        ttlMinutes: deps.env.MAGIC_LINK_TTL_MINUTES,
        now: deps.now(),
      });
      await sendMagicLinkQuietly(deps, {
        to: parsed.data.email,
        purpose: "login",
        link: `${deps.env.MAGIC_LINK_BASE_URL}?token=${token}`,
        ttlMinutes: deps.env.MAGIC_LINK_TTL_MINUTES,
        locale,
      });
    }
    // Anti-enumeration (§2.4): identical response whether or not the account exists.
    return c.body(null, 202);
  });

  // Alias of /login's anti-enumeration semantics — kept as its own route
  // because §2.4 names it explicitly and returns 204 (vs. signup/login's 202).
  app.post("/recover", async (c) => {
    const parsed = RecoverSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);

    const user = await findUserByEmail(deps.db, parsed.data.email);
    if (user) {
      // A3a — misma resolución que /login (locale persistida del usuario).
      const locale = loginEmailLocale(user.preferredLanguageCode, c.req.header("accept-language"));
      const { token } = await issueMagicLink(deps.db, {
        email: parsed.data.email,
        purpose: "login",
        userId: user.id,
        ttlMinutes: deps.env.MAGIC_LINK_TTL_MINUTES,
        now: deps.now(),
      });
      await sendMagicLinkQuietly(deps, {
        to: parsed.data.email,
        purpose: "login",
        link: `${deps.env.MAGIC_LINK_BASE_URL}?token=${token}`,
        ttlMinutes: deps.env.MAGIC_LINK_TTL_MINUTES,
        locale,
      });
    }
    return c.body(null, 204);
  });

  app.post("/verify", async (c) => {
    const parsed = VerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);

    const enrolled = await tryTesterEnrollment(deps, parsed.data.token);
    if (enrolled) {
      const token = await issueSessionToken(deps.sessionDeps, enrolled.userId);
      return c.json({ userId: enrolled.userId, token, email: enrolled.email, displayName: enrolled.displayName });
    }

    const result = await verifyMagicLink(deps.db, parsed.data.token, deps.now());
    if (!result.ok) {
      const message =
        result.error === "token_expired"
          ? "Magic link expired"
          : result.error === "token_already_used"
            ? "Magic link already used"
            : "Invalid magic link";
      return errorResponse(c, "unauthorized", message);
    }

    let userId: string;
    let displayName: string;
    if (result.purpose === "signup") {
      const existing = await findUserByEmail(deps.db, result.email);
      if (existing) {
        // Link consumed twice-in-effect (e.g. a duplicate signup request raced ahead of this verify) — reuse the account rather than erroring.
        userId = existing.id;
        displayName = existing.displayName;
      } else {
        const payload = result.payload as SignupPayload;
        const user = await createUser(deps.db, {
          email: result.email,
          displayName: payload.displayName,
          ageConfirmedAt: payload.ageConfirmedAt,
          countryCode: payload.countryCode,
          preferredLanguageCode: payload.preferredLanguageCode,
        });
        for (const consent of payload.consents) {
          await acceptConsent(deps.db, {
            userId: user.id,
            type: consent.type as (typeof CONSENT_TYPES)[number],
            policyVersion: consent.policyVersion,
          });
        }
        userId = user.id;
        displayName = user.displayName;
      }
    } else {
      if (!result.userId) return errorResponse(c, "internal_error", "Login token missing userId");
      // The user may have been deleted between magic-link issuance and verify — respond with the
      // same generic unauthorized error as an invalid token so we don't leak account-existence info.
      const user = await findUserById(deps.db, result.userId);
      if (!user) return errorResponse(c, "unauthorized", "Invalid magic link");
      userId = user.id;
      displayName = user.displayName;
    }

    const token = await issueSessionToken(deps.sessionDeps, userId);
    return c.json({ userId, token, email: result.email, displayName });
  });

  return app;
}
