import { afterEach, describe, expect, it } from "vitest";

import { es } from "../es";
import { en } from "../en";
import {
  DEFAULT_LOCALE,
  getLocaleStrings,
  getStrings,
  resolveLocale,
  setActiveLocale,
} from "../index";

describe("resolveLocale (precedencia override > dispositivo > es)", () => {
  it("the stored override always wins over the device language", () => {
    expect(resolveLocale("es-SV", "en")).toBe("en");
    expect(resolveLocale("en-US", "es")).toBe("es");
  });

  it("follows the device when there is no override", () => {
    expect(resolveLocale("en-US", null)).toBe("en");
    expect(resolveLocale("en", null)).toBe("en");
    expect(resolveLocale("es-SV", null)).toBe("es");
  });

  it("is case-insensitive on the device tag", () => {
    expect(resolveLocale("EN-us", null)).toBe("en");
  });

  it("falls back to es for ANY unsupported device language", () => {
    expect(resolveLocale("pt-BR", null)).toBe("es");
    expect(resolveLocale("fr", null)).toBe("es");
    expect(resolveLocale("de-DE", null)).toBe("es");
  });

  it("falls back to es when there is no device signal either", () => {
    expect(resolveLocale(null, null)).toBe("es");
    expect(resolveLocale(undefined, null)).toBe("es");
    expect(resolveLocale("", null)).toBe("es");
  });

  it("defaults to es overall", () => {
    expect(DEFAULT_LOCALE).toBe("es");
  });
});

describe("catálogos", () => {
  afterEach(() => {
    setActiveLocale("es");
  });

  /**
   * NO-REGRESIÓN (A1 acceptance): with no stored override and a device
   * language that is not en, the active catalog must be THE SAME `es`
   * object every component rendered before localization existed.
   */
  it("no-regresión: default (sin override, dispositivo no-en) → el MISMO objeto es de siempre", () => {
    expect(resolveLocale("pt-BR", null)).toBe("es");
    expect(getStrings()).toBe(es);
    expect(getLocaleStrings("es")).toBe(es);
  });

  it("en resolves to a DIFFERENT catalog object (es === en would hide A2 regressions)", () => {
    expect(getLocaleStrings("en")).toBe(en);
    expect(getLocaleStrings("en")).not.toBe(es);
  });

  it("setActiveLocale drives the non-reactive getter (pure lib consumers)", () => {
    setActiveLocale("en");
    expect(getStrings()).toBe(en);
    setActiveLocale("es");
    expect(getStrings()).toBe(es);
  });

  /** Deep key-walk of the es shape. */
  function paths(node: unknown, prefix: string[] = []): string[] {
    if (typeof node !== "object" || node === null) return [prefix.join(".")];
    return Object.entries(node).flatMap(([key, value]) => paths(value, [...prefix, key]));
  }

  it("en satisfies the es SHAPE at runtime (tsc enforces the type; this enforces the walk)", () => {
    const esPaths = paths(es);
    const enPaths = new Set(paths(en));
    // Every es path exists in en — `en: Strings` already guarantees this at
    // compile time, but the runtime walk guards against `as any` escapes.
    for (const p of esPaths) expect(enPaths.has(p), `missing key in en: ${p}`).toBe(true);
    // And the reverse: no extra keys either.
    for (const p of enPaths) expect(esPaths.includes(p), `extra key in en: ${p}`).toBe(true);
  });

  it("both catalogs carry the A1 settings section (the selector's labels)", () => {
    expect(typeof es.settings.languageTitle).toBe("string");
    expect(typeof en.settings.languageAuto).toBe("string");
    expect(typeof en.settings.languageEs).toBe("string");
    expect(typeof en.settings.languageEn).toBe("string");
  });

  it("guided explain copy names the topic so the student knows what to write", () => {
    expect(es.guided.explainPrompt("Temas y conceptos básicos de la biología")).toContain(
      "Temas y conceptos básicos de la biología",
    );
    expect(en.guided.explainPrompt("Basic biology themes and concepts")).toContain("Basic biology themes and concepts");
    expect(typeof es.guided.explainIdeasLabel).toBe("string");
    expect(typeof en.guided.explainIdeasLabel).toBe("string");
  });

  it("streak reason copy lives in the catalog (moved out of lib/streak.ts)", () => {
    expect(es.courses.streak.reasons.explainedAcrossSessions).toBe("explicaciones consistentes");
    expect(es.courses.streak.reasons.sustainedOverTime).toBe("constancia en el tiempo");
  });

  /**
   * A2 — no-regresión del placeholder: `en` nació en A1 con el español
   * copiado tal cual. Si una clave vuelve a quedar sin traducir, el español
   * resbala al UI inglés y este walk lo atrapa: ningún valor string de `en`
   * puede llevar marcas de voseo español (verbos en -ás/-é vos, o términos
   * de producto que solo existen en el catálogo es). `Español` en
   * `settings.languageEs` NO es un leak — es el nombre del idioma en su
   * propia lengua, convención de cualquier selector de idioma.
   */
  it("en values carry no untranslated Spanish (voseo/product terms)", () => {
    const spanishOnly: RegExp[] = [
      /pod[ée]s/i,
      /eleg[íi]/i,
      /toc[áa] el enlace/i,
      /mir[áa] la consola/i,
      /volvé/i,
      /ten[ée]s/i,
      /int[ée]nt[áa]/i,
      /\bmateria(s)?\b/i,
      /\btemario\b/i,
      /\bfuentes\b/i,
      /\bmuy pronto\b/i,
    ];
    function walk(node: unknown, path: string): Array<{ path: string; value: string }> {
      if (typeof node === "string") return [{ path, value: node }];
      if (typeof node !== "object" || node === null) return [];
      return Object.entries(node).flatMap(([key, value]) => walk(value, `${path}.${key}`));
    }
    // Match the VALUE only — the key path (e.g. "en.fuentes.*") is an
    // identifier from es.ts, not copy the student sees.
    const offenders = walk(en, "en")
      .filter(({ value }) => spanishOnly.some((re) => re.test(value)))
      .map(({ path, value }) => `${path}: ${value}`);
    expect(offenders).toEqual([]);
  });

  it("the A2 catalog section exists in both locales and covers the El Salvador seed", () => {
    const seedSubjects = ["matematica", "fisica", "quimica", "lenguajeYLiteratura", "historiaDeElSalvador", "ingles"];
    for (const key of seedSubjects) {
      expect(typeof es.catalog.subjects[key as keyof typeof es.catalog.subjects]).toBe("string");
      expect(typeof en.catalog.subjects[key as keyof typeof en.catalog.subjects]).toBe("string");
    }
    expect(en.catalog.stages.bachillerato).toBe("High school");
    expect(en.catalog.gradeLevels.universidad(3)).toBe("Year 3");
  });
});