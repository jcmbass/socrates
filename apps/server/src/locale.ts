/**
 * Locale del server (A3a, localización es/en) — el punto ÚNICO donde el
 * server decide "¿en qué idioma le hablo a este estudiante?".
 *
 * El producto soporta exactamente dos locales hoy (el catálogo del cliente
 * es `{es, en}` — apps/mobile/i18n/). Cualquier otra cosa (fr, pt-BR, un
 * `preferred_language_code`legacy no normalizado) cae a "es": es la locale
 * fundacional, la de la base instalada, y nunca debe haber un estudiante
 * viendo un idioma que no pidió por accidente.
 *
 * NO confundir con i18n de prompts: el copy del tutor/assessor sigue en
 * español incondicional (fase A3b, vetada hasta aprobación del arquitecto).
 * Esto solo cubre la superficie NO-modelo: emails, /entrar y las respuestas
 * estáticas de safety.
 */
export type SupportedLocale = "es" | "en";

/** Locale por defecto del producto — la que la base instalada ya recibe. */
export const DEFAULT_LOCALE: SupportedLocale = "es";

/**
 * Normaliza un `preferredLanguageCode` persistido (o llegado por body) a una
 * locale soportada. Solo "en" escapa del default; todo lo demás es "es".
 * Tolerante con null/undefined porque el valor puede venir de una fila de
 * usuarios escrita antes de que existiera esta normalización.
 */
export function normalizePreferredLanguageCode(
  value: string | null | undefined,
): SupportedLocale {
  return value === "en" ? "en" : DEFAULT_LOCALE;
}

/**
 * Resuelve la locale desde un header `Accept-Language` HTTP.
 *
 * Regla acordada (A3a): "en*" → "en", TODO lo demás → "es". Se respeta el
 * orden por q-value (la convención HTTP: primer rango con mayor q gana) para
 * no inventar una semántica propia, pero la decisión es binaria — no hay
 * tercer idioma al cual caer. `*` y los tags no-en son "resto".
 */
export function localeFromAcceptLanguage(
  header: string | null | undefined,
): SupportedLocale {
  if (!header) return DEFAULT_LOCALE;
  const ranges = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      let q = 1;
      for (const param of params) {
        const match = /^q=([\d.]+)$/.exec(param.trim());
        if (match) q = Number.parseFloat(match[1]);
      }
      return { tag: (tag ?? "").toLowerCase(), q };
    })
    .filter((range) => range.tag.length > 0);
  if (ranges.length === 0) return DEFAULT_LOCALE;

  ranges.sort((a, b) => b.q - a.q);
  const preferred = ranges[0];
  if (preferred.tag === "*") return DEFAULT_LOCALE;
  return preferred.tag.startsWith("en") ? "en" : DEFAULT_LOCALE;
}

/**
 * Precedencia del encargo A3a para el signup: **body > Accept-Language >
 * default "es"**. El body es la intención explícita de la app (ya la conoce
 * porque el usuario acaba de elegir idioma en el selector); el header es la
 * pista del sistema operativo; el default cubre a todo el resto.
 */
export function resolveSignupLocale(
  bodyLocale: string | undefined,
  acceptLanguage: string | null | undefined,
): SupportedLocale {
  if (bodyLocale === "en" || bodyLocale === "es") return bodyLocale;
  return localeFromAcceptLanguage(acceptLanguage);
}