/**
 * A3a — unidad del módulo locale del server + builders bilingües:
 *
 *   - `localeFromAcceptLanguage`: "en*" → "en", resto → "es".
 *   - `formatTtl`/`buildMagicLinkEmailContent` en es y en ("minutes/hours/
 *     days" del glosario A2).
 *   - Safety templates: el inglés contiene EXACTAMENTE los mismos números
 *     y teléfonos que el español (test de igualdad de recursos) — los
 *     recursos NO se traducen, solo el texto envolvente.
 *   - `/entrar` sirve es o en según Accept-Language del navegador.
 *
 * La rama "es" es NO-REGRESIÓN pura: es el texto exacto que se servía
 * antes de A3a (email, página de entrar, CRISIS_REPLY, refusal).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, localeFromAcceptLanguage, normalizePreferredLanguageCode, resolveSignupLocale } from "../src/locale";
import { buildMagicLinkEmailContent, formatTtl } from "../src/auth/email";
import { CRISIS_REPLY, CRISIS_REPLY_EN, JAILBREAK_REFUSAL_REPLY, JAILBREAK_REFUSAL_REPLY_EN, staticReplyFor } from "../src/safety/templates";
import { createEntrarRoutes } from "../src/routes/entrar";

describe("localeFromAcceptLanguage", () => {
  it("en* → en (con y sin región, con q-values)", () => {
    expect(localeFromAcceptLanguage("en")).toBe("en");
    expect(localeFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("en-GB")).toBe("en");
    expect(localeFromAcceptLanguage("es;q=0.5,en;q=0.9")).toBe("en"); // q manda
  });

  it("resto → es", () => {
    expect(localeFromAcceptLanguage("es-ES,es;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("de,en;q=0.8")).toBe("es"); // primer rango no-en
    expect(localeFromAcceptLanguage("*")).toBe("es");
  });

  it("sin header → es", () => {
    expect(localeFromAcceptLanguage(undefined)).toBe("es");
    expect(localeFromAcceptLanguage(null)).toBe("es");
    expect(localeFromAcceptLanguage("")).toBe("es");
  });

  it("precedencia del signup: body > Accept-Language > default", () => {
    expect(resolveSignupLocale("en", "es")).toBe("en");
    expect(resolveSignupLocale("es", "en")).toBe("es");
    expect(resolveSignupLocale(undefined, "en")).toBe("en");
    expect(resolveSignupLocale(undefined, undefined)).toBe(DEFAULT_LOCALE);
  });

  it("normalizePreferredLanguageCode: solo 'en' escapa del default", () => {
    expect(normalizePreferredLanguageCode("en")).toBe("en");
    expect(normalizePreferredLanguageCode("es")).toBe("es");
    expect(normalizePreferredLanguageCode("fr")).toBe("es");
    expect(normalizePreferredLanguageCode(null)).toBe("es");
    expect(normalizePreferredLanguageCode(undefined)).toBe("es");
  });
});

describe("formatTtl en inglés", () => {
  it("minutes/hours/days", () => {
    expect(formatTtl(20, "en")).toBe("20 minutes");
    expect(formatTtl(1, "en")).toBe("1 minute");
    expect(formatTtl(120, "en")).toBe("2 hours");
    expect(formatTtl(60, "en")).toBe("1 hour");
    expect(formatTtl(1440, "en")).toBe("1 day");
    expect(formatTtl(2880, "en")).toBe("2 days");
    expect(formatTtl(90, "en")).toBe("1 h 30 min");
  });

  it("es queda igual que siempre (no-regresión)", () => {
    expect(formatTtl(20, "es")).toBe("20 minutos");
    expect(formatTtl(1, "es")).toBe("1 minuto");
    expect(formatTtl(120, "es")).toBe("2 horas");
    expect(formatTtl(1440, "es")).toBe("1 día");
  });
});

describe("buildMagicLinkEmailContent bilingüe", () => {
  const base = {
    to: "student@example.com",
    link: "https://example.com/verify?token=abc",
    purpose: "signup" as const,
    ttlMinutes: 20,
  };

  it("es — texto exacto pre-A3a (asunto, voseo, ttl en español)", () => {
    const es = buildMagicLinkEmailContent({ ...base, locale: "es" });
    expect(es.subject).toBe("Confirmá tu cuenta en Socrates");
    expect(es.text).toContain("Usá este enlace para continuar. Expira en 20 minutos:");
    expect(es.text).toContain("Si no pediste este correo, ignoralo. Tu cuenta no cambia.");
    expect(es.html).toContain('lang="es"');
    expect(es.html).toContain("Confirmar mi cuenta");
    expect(es.html).toContain("Copiá y pegá este enlace");
  });

  it("en — inglés de producto, marca intacta, ttl en inglés", () => {
    const en = buildMagicLinkEmailContent({ ...base, locale: "en" });
    expect(en.subject).toBe("Confirm your Socrates account");
    expect(en.text).toContain("Use this link to continue. It expires in 20 minutes:");
    expect(en.text).toContain("If you didn't request this email, ignore it. Your account doesn't change.");
    expect(en.html).toContain('lang="en"');
    expect(en.html).toContain("Confirm my account");
    expect(en.html).toContain("Expires in");
    expect(en.html).toContain("Socrates");
    // El inglés NO arrastra voseo ni español sin traducir.
    expect(en.subject).not.toMatch(/Confirmá|Expira/);
    expect(en.text).not.toMatch(/podés|tocá/i);
  });

  it("login en ambos idiomas", () => {
    const es = buildMagicLinkEmailContent({ ...base, purpose: "login", locale: "es" });
    const en = buildMagicLinkEmailContent({ ...base, purpose: "login", locale: "en" });
    expect(es.subject).toBe("Tu enlace para entrar a Socrates");
    expect(en.subject).toBe("Your sign-in link for Socrates");
    expect(en.text).toContain("sign in to Socrates");
  });

  it("sin locale explícita → es (compatibilidad con llamadores pre-A3a)", () => {
    const content = buildMagicLinkEmailContent(base);
    expect(content.subject).toBe("Confirmá tu cuenta en Socrates");
  });
});

/**
 * Test de IGUALDAD DE RECURSOS (AJUSTE 3): el mensaje de crisis en inglés
 * cita exactamente los mismos teléfonos/números que el español. Extrae los
 * tokens numéricos de ambos textos y exige identidad — si mañana alguien
 * traduce "131" a "988" en inglés, la suite rompe.
 */
describe("safety templates — recursos idénticos en es y en", () => {
  const RESOURCE_PATTERN = /\d[\d-]*\d|\d/g;

  function recursos(texto: string): string[] {
    return texto.match(RESOURCE_PATTERN) ?? [];
  }

  it("CRISIS_REPLY y CRISIS_REPLY_EN citan los mismos números", () => {
    expect(recursos(CRISIS_REPLY_EN)).toEqual(recursos(CRISIS_REPLY));
  });

  it("los recursos esperados están en AMBAS versiones", () => {
    for (const reply of [CRISIS_REPLY, CRISIS_REPLY_EN]) {
      expect(reply).toContain("911");
      expect(reply).toContain("7071-1302");
      expect(reply).toContain("2591-6557");
      expect(reply).toContain("131");
      expect(reply).toContain("126");
    }
  });

  it("opción 4 del IVR del 131 se conserva en ambos idiomas", () => {
    expect(CRISIS_REPLY).toContain("opción 4");
    expect(CRISIS_REPLY_EN).toContain("option 4");
  });

  it("staticReplyFor resuelve por locale, default y legacy caen a es", () => {
    expect(staticReplyFor("self_harm", "en")).toBe(CRISIS_REPLY_EN);
    expect(staticReplyFor("self_harm", "es")).toBe(CRISIS_REPLY);
    expect(staticReplyFor("abuse_disclosure", "fr")).toBe(CRISIS_REPLY); // legacy no soportada
    expect(staticReplyFor("self_harm")).toBe(CRISIS_REPLY); // sin locale → pre-A3a
    expect(staticReplyFor("jailbreak_attempt", "en")).toBe(JAILBREAK_REFUSAL_REPLY_EN);
    expect(staticReplyFor("other", "es")).toBe(JAILBREAK_REFUSAL_REPLY);
    expect(staticReplyFor("other", undefined)).toBe(JAILBREAK_REFUSAL_REPLY);
  });

  it("el refusal en inglés no traduce marca ni promete de más", () => {
    expect(JAILBREAK_REFUSAL_REPLY_EN).toContain("tutor");
    expect(JAILBREAK_REFUSAL_REPLY_EN).not.toMatch(/podés|estás/i);
  });
});

describe("/entrar bilingüe (Accept-Language del navegador)", () => {
  const app = createEntrarRoutes();
  const TOKEN = "abc_DEF-0123456789";

  it("sin header → es (no-regresión byte-nivel con la página pre-A3a)", async () => {
    const res = await app.request(`/?token=${TOKEN}`);
    const html = await res.text();
    expect(html).toContain('lang="es"');
    expect(html).toContain("Abrí Socrates");
    expect(html).toContain("Abrir Socrates");
    expect(html).not.toContain('lang="en"');
  });

  it("Accept-Language en → página en inglés", async () => {
    const res = await app.request(`/?token=${TOKEN}`, {
      headers: { "accept-language": "en-US,en;q=0.9" },
    });
    const html = await res.text();
    expect(html).toContain('lang="en"');
    expect(html).toContain("Open Socrates");
    expect(html).toContain("If it didn't open on its own, tap the button.");
    expect(html).toContain(`buxo://login?token=${TOKEN}`);
    expect(html).not.toContain("Abrí");
  });

  it("Accept-Language fr → es (resto cae al default)", async () => {
    const res = await app.request(`/?token=${TOKEN}`, {
      headers: { "accept-language": "fr-FR,fr;q=0.9" },
    });
    const html = await res.text();
    expect(html).toContain("Abrí Socrates");
  });

  it("página de error también bilingüe", async () => {
    const es = await (await app.request("/")).text();
    const en = await (await app.request("/", { headers: { "accept-language": "en" } })).text();
    expect(es).toContain("Enlace incompleto");
    expect(en).toContain("Incomplete link");
    expect(en).toContain("Request a new one from the Socrates app");
  });
});