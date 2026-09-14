/**
 * Public trampoline: WhatsApp-friendly `https://…/entrar?token=…` →
 * `buxo://login?token=…`. Does NOT validate or consume the token — that
 * stays with `POST /v1/auth/verify` when the app opens.
 *
 * Destination scheme is hard-coded (`buxo://login`). Never take a
 * redirect target from the query (open-redirect / phishing vector).
 */
import { Hono } from "hono";
import { localeFromAcceptLanguage } from "../locale";

/**
 * A3a — copy mínimo del trampolín en las dos locales del producto. El
 * default es "es" (locale fundacional: un navegador sin Accept-Language, o
 * con cualquier idioma no-en, ve EXACTAMENTE la página de siempre). El
 * trampolín no sabe nada del usuario (público, sin auth) — solo puede
 * seguirle la pista al header del navegador.
 */
const COPY = {
  es: {
    title: "Abrir Socrates",
    successHeading: "Abrí Socrates",
    successBody:
      "Si no se abrió sola, tocá el botón. Necesitás tener Socrates instalado en este teléfono.",
    successButton: "Abrir Socrates",
    errorHeading: "Enlace incompleto",
    errorBody:
      "Este enlace no trae un código de acceso válido. Pedí uno nuevo desde la app Socrates.",
  },
  en: {
    title: "Open Socrates",
    successHeading: "Open Socrates",
    successBody:
      "If it didn't open on its own, tap the button. You need Socrates installed on this phone.",
    successButton: "Open Socrates",
    errorHeading: "Incomplete link",
    errorBody:
      "This link doesn't carry a valid access code. Request a new one from the Socrates app.",
  },
} as const;

/** Magic-link tokens are `randomBytes(32).toString("base64url")`. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

/** Escape for HTML text and double-quoted attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape for a double-quoted JavaScript string literal. */
export function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/</g, "\\u003c");
}

function deepLink(token: string): string {
  return `buxo://login?token=${token}`;
}

function pageShell(body: string, locale: "es" | "en"): string {
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${COPY[locale].title}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:2rem 1.25rem;background:#f7f4ef;color:#1a1a1a;min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
  h1{font-size:1.35rem;font-weight:650;margin:0 0 .75rem}
  p{font-size:1rem;line-height:1.45;margin:0 0 1.5rem;max-width:22rem;color:#3a3a3a}
  a.btn{display:inline-block;padding:.9rem 1.5rem;background:#1a1a1a;color:#fff;text-decoration:none;font-size:1.05rem;font-weight:600;border-radius:10px}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function successPage(token: string, locale: "es" | "en"): string {
  const href = deepLink(token);
  const hrefAttr = escapeHtml(href);
  const hrefJs = escapeJsString(href);
  const copy = COPY[locale];
  return pageShell(`<h1>${copy.successHeading}</h1>
<p>${copy.successBody}</p>
<a class="btn" href="${hrefAttr}">${copy.successButton}</a>
<script>window.location.href="${hrefJs}";</script>`, locale);
}

function errorPage(locale: "es" | "en"): string {
  const copy = COPY[locale];
  return pageShell(`<h1>${copy.errorHeading}</h1>
<p>${copy.errorBody}</p>`, locale);
}

export function createEntrarRoutes(): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const locale = localeFromAcceptLanguage(c.req.header("accept-language"));
    const raw = c.req.query("token");
    if (raw === undefined || raw === "" || !TOKEN_PATTERN.test(raw)) {
      return c.html(errorPage(locale), 200, HEADERS);
    }
    return c.html(successPage(raw, locale), 200, HEADERS);
  });

  return app;
}
