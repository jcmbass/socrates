/**
 * Email transport interface (DF-6.2: "en dev/tests el transporte de email
 * se mockea"). Production wires `ResendEmailSender` behind the same interface
 * when `EMAIL_SENDER=resend` (BE3, 2026-08-02). Dev/default keeps
 * `ConsoleEmailSender` (zero network). Tests inject `RecordingEmailSender`.
 *
 * Decision SDK vs fetch (BE3): **fetch pelado**, no paquete `resend`.
 * Motivo: el repo ya usa fetch nativo; una dependencia nueva entra a la
 * imagen Docker de Render; la API es un POST JSON trivial
 * (`POST https://api.resend.com/emails`).
 */
export interface MagicLinkEmail {
  to: string;
  link: string;
  purpose: "signup" | "login";
  /** From `MAGIC_LINK_TTL_MINUTES` — never hardcode in copy. */
  ttlMinutes: number;
  /**
   * A3a — idioma del correo, resuelto en el handler (body > Accept-Language
   * > `users.preferredLanguageCode` para login). Opcional con default "es"
   * para no romper a los llamadores que ya construían este objeto sin ella
   * (tests, ConsoleEmailSender): "es" es la locale que SIEMPRE se servía
   * antes de A3a.
   */
  locale?: "es" | "en";
}

export interface EmailSender {
  sendMagicLink(email: MagicLinkEmail): Promise<void>;
}

/**
 * Dev/test double: never makes a network call, just records what WOULD
 * have been sent so tests (and a founder running locally) can read the
 * link straight off this sink instead of a real inbox.
 */
export class RecordingEmailSender implements EmailSender {
  public readonly sent: MagicLinkEmail[] = [];

  async sendMagicLink(email: MagicLinkEmail): Promise<void> {
    this.sent.push(email);
  }

  /** Convenience for tests/dev: the most recent link sent to a given address. */
  lastLinkFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to)?.link;
  }
}

/** Dev-mode console sink — still zero network I/O, just logs instead of silently recording. */
export class ConsoleEmailSender implements EmailSender {
  async sendMagicLink(email: MagicLinkEmail): Promise<void> {
    console.log(`[dev-email] magic link (${email.purpose}) for ${email.to}: ${email.link}`);
  }
}

export type FetchLike = typeof fetch;

export interface ResendEmailSenderOptions {
  apiKey: string;
  from: string;
  /** Injectable for unit tests — defaults to global `fetch`. */
  fetchImpl?: FetchLike;
  /** Override for tests; production always hits Resend. */
  apiUrl?: string;
}

/**
 * Humaniza el vencimiento. Producción llegó a estar en 1440 minutos y el
 * correo decía literalmente "Expira en 1440 minutos" — nadie divide 1440
 * entre 60 leyendo un correo. Se dice en la unidad que la persona piensa.
 * A3a: unidades también en inglés ("minutes/hours/days" del glosario A2).
 */
export function formatTtl(minutes: number, locale: "es" | "en" = "es"): string {
  if (locale === "en") {
    if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    if (minutes % 1440 === 0) {
      const d = minutes / 1440;
      return `${d} ${d === 1 ? "day" : "days"}`;
    }
    if (minutes % 60 === 0) {
      const h = minutes / 60;
      return `${h} ${h === 1 ? "hour" : "hours"}`;
    }
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h} h ${m} min`;
  }
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} ${d === 1 ? "día" : "días"}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} ${h === 1 ? "hora" : "horas"}`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${m} min`;
}

/**
 * Paleta de marca para el correo (DESIGN.md §2). Hex literal y no tokens
 * importados a propósito: `apps/mobile/theme/tokens.ts` es del cliente RN y
 * el server no debe depender de él. `ACCENT_CONTRAST` es casi-negro porque
 * `ACCENT` es un azul CLARO — texto blanco encima da ~2.5:1 (reprueba AA),
 * texto oscuro da ~7.5:1. Mismo razonamiento que `PrimaryButton`.
 */
const BRAND = {
  ACCENT: "#58a6ff",
  ACCENT_CONTRAST: "#0d1117",
  DARK: "#0d1117",
  PAGE: "#f7f4ef",
  CARD: "#ffffff",
  CARD_BORDER: "#e3ded6",
  TEXT: "#26221d",
  TEXT_MUTED: "#6e6a63",
} as const;

/** Pila de fuentes del sistema: cero descargas, cero webfonts. */
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/**
 * Builds subject + HTML + plain-text bodies for a magic-link email.
 * Spanish (El Salvador, voseo) or English (A3a) per `email.locale` —
 * adult tone, brand "Socrates" (never translated).
 *
 * **SIN IMÁGENES, ni remotas ni incrustadas — es una decisión, no un olvido:**
 * 1. *Entregabilidad y anti-phishing* (criterio original de este módulo): un
 *    correo de acceso con imágenes remotas y redirecciones de tracking es
 *    justo el perfil que los filtros castigan.
 * 2. *Arranque en frío*: el servidor duerme cuando no recibe tráfico. Una
 *    imagen servida por él se pediría al ABRIR el correo, quizá horas
 *    después — el estudiante vería un hueco roto mientras Render despierta.
 * 3. *Data URI no es salida*: Gmail bloquea `src="data:…"`.
 * 4. *Peso*: los teléfonos de los estudiantes son modestos y muchos con
 *    datos medidos. Este cuerpo pesa ~5 KB y no hace UNA sola petición.
 * La marca la carga la tipografía y el color, que se ven igual aunque el
 * cliente bloquee imágenes — que es el caso por defecto en varios. Cuando
 * `cubo.lat` tenga hosting estático (no Render), un logo pequeño ahí sí
 * sería viable: la objeción 2 desaparece.
 *
 * Maquetado con TABLAS y estilos EN LÍNEA porque los clientes de correo no
 * son navegadores: Outlook de escritorio renderiza con el motor de Word (sin
 * flexbox ni grid) y varios clientes descartan el `<style>` del `<head>`.
 * `color-scheme: light` evita que el modo oscuro de Gmail/Outlook invierta
 * los colores a mano y arruine el contraste del botón.
 *
 * The `email.link` arrives already assembled (`MAGIC_LINK_BASE_URL` + token).
 * Whether that is `https://…` or a custom scheme (`buxo://…`), the body
 * always includes the raw URL as copyable text — many mail clients do not
 * linkify non-http schemes.
 */
/**
 * A3a — copy por locale. El español es el TEXTO EXACTO que se servía antes
 * de A3a (voseo salvadoreño incluido): la base instalada no debe ver ni un
 * byte de cambio. El inglés es inglés de producto (glosario A2: marca
 * Socrates intacta, tono directo sin hype, "you" neutral — el voseo no
 * tiene equivalente). Contacto y marca iguales en ambos.
 */
const COPY = {
  es: {
    subjectSignup: "Confirmá tu cuenta en Socrates",
    subjectLogin: "Tu enlace para entrar a Socrates",
    actionSignup: "confirmar tu cuenta",
    actionLogin: "iniciar sesión",
    ctaSignup: "Confirmar mi cuenta",
    ctaLogin: "Entrar a Socrates",
    leadSignup: "Ya casi. Tocá el botón para confirmar tu cuenta y empezar a estudiar.",
    leadLogin: "Tocá el botón para entrar a tu cuenta.",
    greeting: "Hola,",
    requestLine: (action: string) => `Recibimos una solicitud para ${action} en Socrates.`,
    useLink: "Usá este enlace para continuar. Expira en",
    notYou: "Si no pediste este correo, ignoralo. Tu cuenta no cambia.",
    contact: "¿Dudas? Escribinos a hola@cubo.lat (no respondas a este correo).",
    signoff: "— Socrates",
    preheader: (ttl: string) => `Tu enlace vence en ${ttl}.`,
    expiresPrefix: "Expira en",
    buttonFallback: "¿No funciona el botón? Copiá y pegá este enlace:",
    footerContact1: "¿Dudas? Escribinos a",
    footerContact2: "No respondas a este correo — nadie lo lee.",
  },
  en: {
    subjectSignup: "Confirm your Socrates account",
    subjectLogin: "Your sign-in link for Socrates",
    actionSignup: "confirm your account",
    actionLogin: "sign in to Socrates",
    ctaSignup: "Confirm my account",
    ctaLogin: "Sign in to Socrates",
    leadSignup: "Almost there. Tap the button to confirm your account and start studying.",
    leadLogin: "Tap the button to sign in to your account.",
    greeting: "Hello,",
    requestLine: (action: string) => `We received a request to ${action} (Socrates).`,
    useLink: "Use this link to continue. It expires in",
    notYou: "If you didn't request this email, ignore it. Your account doesn't change.",
    contact: "Questions? Email hola@cubo.lat (don't reply to this message).",
    signoff: "— Socrates",
    preheader: (ttl: string) => `Your link expires in ${ttl}.`,
    expiresPrefix: "Expires in",
    buttonFallback: "Button not working? Copy and paste this link:",
    footerContact1: "Questions? Email",
    footerContact2: "Don't reply to this email — nobody reads it.",
  },
} as const;

export function buildMagicLinkEmailContent(email: MagicLinkEmail): {
  subject: string;
  html: string;
  text: string;
} {
  const locale = email.locale ?? "es";
  const copy = COPY[locale];
  const isSignup = email.purpose === "signup";
  const subject = isSignup ? copy.subjectSignup : copy.subjectLogin;
  const action = isSignup ? copy.actionSignup : copy.actionLogin;
  const cta = isSignup ? copy.ctaSignup : copy.ctaLogin;
  const lead = isSignup ? copy.leadSignup : copy.leadLogin;
  const ttl = formatTtl(email.ttlMinutes, locale);

  const text = [
    "SOCRATES",
    "",
    copy.greeting,
    "",
    copy.requestLine(action),
    "",
    `${copy.useLink} ${ttl}:`,
    "",
    email.link,
    "",
    copy.notYou,
    "",
    copy.contact,
    "",
    copy.signoff,
  ].join("\n");

  // Escape only what we interpolate into HTML attributes/text.
  const safeLink = escapeHtml(email.link);

  /**
   * Preheader: el fragmento que el cliente muestra junto al asunto en la
   * bandeja. Sin esto muestra "Hola, Recibimos una solicitud…", que no
   * aporta nada. Oculto con la receta estándar (alto 0 + color de fondo);
   * los espacios finales evitan que el cliente rellene el resto del preview
   * con el principio del cuerpo.
   */
  const preheader = copy.preheader(ttl);

  const html = `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Socrates</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.PAGE};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${BRAND.PAGE};">${preheader}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.PAGE};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;margin:0 auto;">

<tr><td align="center" style="background-color:${BRAND.DARK};border-radius:12px 12px 0 0;padding:22px 24px;">
<span style="font-family:${FONT};font-size:21px;font-weight:700;letter-spacing:0.3px;color:${BRAND.ACCENT};">Socrates</span>
</td></tr>

<tr><td style="background-color:${BRAND.CARD};border:1px solid ${BRAND.CARD_BORDER};border-top:none;border-radius:0 0 12px 12px;padding:28px 24px;font-family:${FONT};font-size:16px;line-height:1.55;color:${BRAND.TEXT};">
<p style="margin:0 0 14px;">${copy.greeting}</p>
<p style="margin:0 0 22px;">${lead}</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px;">
<tr><td align="center" bgcolor="${BRAND.ACCENT}" style="border-radius:10px;">
<a href="${safeLink}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;font-weight:600;color:${BRAND.ACCENT_CONTRAST};text-decoration:none;border-radius:10px;">${cta}</a>
</td></tr>
</table>

<p style="margin:0 0 22px;text-align:center;font-size:14px;color:${BRAND.TEXT_MUTED};">${copy.expiresPrefix} <strong style="color:${BRAND.TEXT};">${ttl}</strong>.</p>

<p style="margin:0 0 8px;font-size:14px;color:${BRAND.TEXT_MUTED};">${copy.buttonFallback}</p>
<p style="margin:0 0 24px;word-break:break-all;font-family:${MONO};font-size:13px;line-height:1.45;color:${BRAND.TEXT};">${safeLink}</p>

<p style="margin:0;padding-top:18px;border-top:1px solid ${BRAND.CARD_BORDER};font-size:14px;color:${BRAND.TEXT_MUTED};">${copy.notYou}</p>
</td></tr>

<tr><td align="center" style="padding:18px 24px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${BRAND.TEXT_MUTED};">
${copy.footerContact1} <a href="mailto:hola@cubo.lat" style="color:${BRAND.TEXT_MUTED};">hola@cubo.lat</a><br>${copy.footerContact2}
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Real Resend transport. Throws on non-2xx or network failure so callers
 * can decide how to surface the error. Auth routes catch and log without
 * changing the anti-enumeration response (see `routes/auth.ts`).
 */
export class ResendEmailSender implements EmailSender {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiUrl: string;

  constructor(options: ResendEmailSenderOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiUrl = options.apiUrl ?? "https://api.resend.com/emails";
  }

  async sendMagicLink(email: MagicLinkEmail): Promise<void> {
    const { subject, html, text } = buildMagicLinkEmailContent(email);
    const res = await this.fetchImpl(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Resend email failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}`,
      );
    }
  }
}

export interface EmailSenderEnv {
  EMAIL_SENDER: "console" | "resend";
  RESEND_API_KEY?: string;
  EMAIL_FROM: string;
}

/** Selects the transport from env. Call only after `readEnv` (fail-loud already ran). */
export function createEmailSender(env: EmailSenderEnv): EmailSender {
  if (env.EMAIL_SENDER === "resend") {
    // Guaranteed by env.ts superRefine when EMAIL_SENDER=resend.
    return new ResendEmailSender({
      apiKey: env.RESEND_API_KEY!,
      from: env.EMAIL_FROM,
    });
  }
  return new ConsoleEmailSender();
}
