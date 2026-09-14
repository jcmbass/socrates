/**
 * BE3 — ResendEmailSender unit tests. Zero real network: fetch is injected.
 */
import { describe, expect, it, vi } from "vitest";
import {
  formatTtl,
  ResendEmailSender,
  buildMagicLinkEmailContent,
  createEmailSender,
  ConsoleEmailSender,
} from "../../src/auth/email";
import type { FetchLike, MagicLinkEmail } from "../../src/auth/email";

const sample: MagicLinkEmail = {
  to: "estudiante@example.com",
  link: "https://app.example/entrar?token=abc123",
  purpose: "login",
  ttlMinutes: 20,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildMagicLinkEmailContent", () => {
  it("includes the raw link as copyable text (not only as an href)", () => {
    const { html, text, subject } = buildMagicLinkEmailContent(sample);
    expect(subject).toBe("Tu enlace para entrar a Socrates");
    expect(text).toContain(sample.link);
    expect(text).toContain("Expira en 20 minutos");
    expect(text).toContain("Si no pediste este correo");
    expect(html).toContain(`href="${sample.link}"`);
    expect(html).toContain(sample.link);
    expect(html).toMatch(/copiá y pegá/i);
  });

  it("uses ttlMinutes from the payload (not a hardcoded 20)", () => {
    const { text, html } = buildMagicLinkEmailContent({ ...sample, ttlMinutes: 7, purpose: "signup" });
    expect(text).toContain("Expira en 7 minutos");
    expect(html).toContain("7 minutos");
    expect(text).not.toContain("Expira en 20 minutos");
  });

  it("works with a custom-scheme link (buxo://) as copyable text", () => {
    const deep: MagicLinkEmail = {
      ...sample,
      link: "buxo://login?token=xyz",
      purpose: "signup",
    };
    const { html, text, subject } = buildMagicLinkEmailContent(deep);
    expect(subject).toBe("Confirmá tu cuenta en Socrates");
    expect(text).toContain("buxo://login?token=xyz");
    expect(html).toContain("buxo://login?token=xyz");
  });
});

describe("ResendEmailSender", () => {
  it("POSTs to Resend with Bearer auth, from/to/subject/html/text — no real network", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(200, { id: "re_mock_id" }));
    const sender = new ResendEmailSender({
      apiKey: "re_test_key_not_real",
      from: "Socrates <onboarding@resend.dev>",
      fetchImpl,
    });

    await sender.sendMagicLink(sample);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key_not_real");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(init?.body)) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    };
    expect(body.from).toBe("Socrates <onboarding@resend.dev>");
    expect(body.to).toEqual(["estudiante@example.com"]);
    expect(body.subject).toBe("Tu enlace para entrar a Socrates");
    expect(body.text).toContain(sample.link);
    expect(body.html).toContain(sample.link);
  });

  it("throws on non-2xx so callers can decide (auth swallows for anti-enumeration)", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response("rate limited", { status: 429 }));
    const sender = new ResendEmailSender({
      apiKey: "re_test_key_not_real",
      from: "Socrates <onboarding@resend.dev>",
      fetchImpl,
    });
    await expect(sender.sendMagicLink(sample)).rejects.toThrow(/Resend email failed: HTTP 429/);
  });
});

describe("createEmailSender", () => {
  it("defaults to ConsoleEmailSender when EMAIL_SENDER=console", () => {
    const sender = createEmailSender({
      EMAIL_SENDER: "console",
      EMAIL_FROM: "Socrates <onboarding@resend.dev>",
    });
    expect(sender).toBeInstanceOf(ConsoleEmailSender);
  });

  it("returns ResendEmailSender when EMAIL_SENDER=resend", () => {
    const sender = createEmailSender({
      EMAIL_SENDER: "resend",
      RESEND_API_KEY: "re_test_key_not_real",
      EMAIL_FROM: "Socrates <onboarding@resend.dev>",
    });
    expect(sender).toBeInstanceOf(ResendEmailSender);
  });
});

/**
 * Producción llegó a estar en 1440 minutos y el correo decía "Expira en 1440
 * minutos". Nadie lee eso como "un día". El founder lo bajó a 15, pero el
 * defecto de redacción seguía latente para cualquier valor grande.
 */
describe("formatTtl — el vencimiento se dice como lo piensa una persona", () => {
  it("usa minutos por debajo de una hora", () => {
    expect(formatTtl(15)).toBe("15 minutos");
    expect(formatTtl(1)).toBe("1 minuto");
  });

  it("convierte a horas los múltiplos exactos", () => {
    expect(formatTtl(60)).toBe("1 hora");
    expect(formatTtl(120)).toBe("2 horas");
  });

  it("convierte a días — el caso real que estuvo en producción", () => {
    expect(formatTtl(1440)).toBe("1 día");
    expect(formatTtl(2880)).toBe("2 días");
  });

  it("no inventa unidades redondas cuando no las hay", () => {
    expect(formatTtl(90)).toBe("1 h 30 min");
  });

  it("el cuerpo del correo NO dice el número crudo seguido de 'minutos'", () => {
    const { text } = buildMagicLinkEmailContent({ ...sample, ttlMinutes: 1440 });
    expect(text).toContain("Expira en 1 día");
    expect(text).not.toContain("1440");
  });

  it("ofrece un contacto que sí recibe (una respuesta a no-reply@ no llega a nadie)", () => {
    const { text, html } = buildMagicLinkEmailContent(sample);
    expect(text).toContain("hola@cubo.lat");
    expect(html).toContain("mailto:hola@cubo.lat");
  });
});
