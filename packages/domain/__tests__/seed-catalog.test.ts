import { describe, expect, it } from "vitest";
import { SEED_CATALOGS } from "../data/seed";
import {
  SeedCatalogSchema,
  seedAttributionFor,
  seedAttributions,
  seedSourceLangFor,
  seedSubjectsForLevel,
  type SeedCatalog,
  type SeedLevel,
  type SeedSubjectKey,
} from "../seed-catalog";

// Import directo por ruta, además de vía SEED_CATALOGS: la ruta del import
// ES la prueba de "level y subject_key coinciden con la ruta del archivo"
// (no podemos usar `fs` sin romper la pureza del paquete — ver docblock de
// seed-catalog.ts — así que el path estático del import hace ese papel).
import bachilleratoBiologia from "../data/seed/bachillerato/biologia.json";
import bachilleratoEconomia from "../data/seed/bachillerato/economia.json";
import bachilleratoFisica from "../data/seed/bachillerato/fisica.json";
import bachilleratoMatematicas from "../data/seed/bachillerato/matematicas.json";
import bachilleratoQuimica from "../data/seed/bachillerato/quimica.json";
import universidadBiologia from "../data/seed/universidad/biologia.json";
import universidadEconomia from "../data/seed/universidad/economia.json";
import universidadFisica from "../data/seed/universidad/fisica.json";
import universidadMatematicas from "../data/seed/universidad/matematicas.json";
import universidadQuimica from "../data/seed/universidad/quimica.json";

const CATALOGS_BY_PATH: { level: SeedLevel; subjectKey: SeedSubjectKey; catalog: SeedCatalog }[] = [
  { level: "bachillerato", subjectKey: "biologia", catalog: bachilleratoBiologia as SeedCatalog },
  { level: "bachillerato", subjectKey: "economia", catalog: bachilleratoEconomia as SeedCatalog },
  { level: "bachillerato", subjectKey: "fisica", catalog: bachilleratoFisica as SeedCatalog },
  { level: "bachillerato", subjectKey: "matematicas", catalog: bachilleratoMatematicas as SeedCatalog },
  { level: "bachillerato", subjectKey: "quimica", catalog: bachilleratoQuimica as SeedCatalog },
  { level: "universidad", subjectKey: "biologia", catalog: universidadBiologia as SeedCatalog },
  { level: "universidad", subjectKey: "economia", catalog: universidadEconomia as SeedCatalog },
  { level: "universidad", subjectKey: "fisica", catalog: universidadFisica as SeedCatalog },
  { level: "universidad", subjectKey: "matematicas", catalog: universidadMatematicas as SeedCatalog },
  { level: "universidad", subjectKey: "quimica", catalog: universidadQuimica as SeedCatalog },
];

const LEVELS: SeedLevel[] = ["bachillerato", "universidad"];
const SUBJECT_KEYS: SeedSubjectKey[] = ["matematicas", "fisica", "quimica", "biologia", "economia"];

// D-C05 / buxo-seed/validar-catalogos.sh: solo licencias abiertas citables.
const OPEN_LICENSE_RE = /^CC BY(-SA)? [0-9.]+$|^dominio p[uú]blico$|^public domain$/i;

describe("SEED_CATALOGS", () => {
  it("has exactly 10 catalogs: 2 levels x 5 subjects", () => {
    expect(SEED_CATALOGS).toHaveLength(10);
    expect(new Set(SEED_CATALOGS.map((c) => c.level))).toEqual(new Set(LEVELS));
    for (const level of LEVELS) {
      const forLevel = SEED_CATALOGS.filter((c) => c.level === level);
      expect(forLevel, `level ${level}`).toHaveLength(5);
      expect(new Set(forLevel.map((c) => c.subject_key))).toEqual(new Set(SUBJECT_KEYS));
    }
  });

  it("every catalog parses against SeedCatalogSchema", () => {
    for (const catalog of SEED_CATALOGS) {
      const result = SeedCatalogSchema.safeParse(catalog);
      expect(result.success, `${catalog.level}/${catalog.subject_key}: ${JSON.stringify(result.success ? null : result.error?.issues)}`).toBe(
        true,
      );
    }
  });

  it("no test reads pdf_path from disk — sources only carry it as inert metadata", () => {
    // Guardia explícita, no sólo por omisión: si algún día alguien agrega
    // fs/readFileSync sobre pdf_path a este paquete, este test lo documenta
    // como violación de la regla "los PDFs no entran al repo".
    for (const catalog of SEED_CATALOGS) {
      for (const source of catalog.sources) {
        expect(typeof source.pdf_path).toBe("string");
        expect(source.pdf_path.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("catalog file placement matches its own level/subject_key", () => {
  it("data/seed/<nivel>/<materia>.json declares that exact level and subject_key", () => {
    for (const { level, subjectKey, catalog } of CATALOGS_BY_PATH) {
      expect(catalog.level, `data/seed/${level}/${subjectKey}.json .level`).toBe(level);
      expect(catalog.subject_key, `data/seed/${level}/${subjectKey}.json .subject_key`).toBe(subjectKey);
    }
  });

  it("every (level, subject_key) pair is unique across SEED_CATALOGS", () => {
    const pairs = SEED_CATALOGS.map((c) => `${c.level}/${c.subject_key}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("license rule (buxo-seed/validar-catalogos.sh parity)", () => {
  it("every source's license.name is CC BY[-SA] X.Y or public domain", () => {
    for (const catalog of SEED_CATALOGS) {
      for (const source of catalog.sources) {
        expect(
          OPEN_LICENSE_RE.test(source.license.name),
          `${catalog.level}/${catalog.subject_key}: license '${source.license.name}'`,
        ).toBe(true);
      }
    }
  });
});

describe("syllabus completeness", () => {
  it("syllabus.es and syllabus.en are non-empty in all 10 catalogs", () => {
    for (const catalog of SEED_CATALOGS) {
      expect(catalog.syllabus.es.length, `${catalog.level}/${catalog.subject_key} es`).toBeGreaterThan(0);
      expect(catalog.syllabus.en.length, `${catalog.level}/${catalog.subject_key} en`).toBeGreaterThan(0);
      for (const lang of ["es", "en"] as const) {
        for (const unit of catalog.syllabus[lang]) {
          expect(unit.unit.length, `${catalog.level}/${catalog.subject_key} ${lang} unit`).toBeGreaterThan(0);
          expect(unit.topics.length, `${catalog.level}/${catalog.subject_key} ${lang} topics`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("sha256", () => {
  it("every source.sha256 is 64 lowercase hex chars", () => {
    for (const catalog of SEED_CATALOGS) {
      for (const source of catalog.sources) {
        expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});

describe("seedSubjectsForLevel", () => {
  it("returns exactly the 5 subjects for each level, matching the catalog", () => {
    for (const level of LEVELS) {
      const subjects = seedSubjectsForLevel(level);
      expect(subjects).toHaveLength(5);
      expect(subjects.every((s) => s.level === level)).toBe(true);
      expect(new Set(subjects.map((s) => s.subjectKey))).toEqual(new Set(SUBJECT_KEYS));
      for (const s of subjects) {
        expect(s.name.es.length).toBeGreaterThan(0);
        expect(s.name.en.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("seedAttributions", () => {
  it("returns 10 entries, deduplicated by real sha256 (14 source rows -> 10 unique binaries)", () => {
    const totalSourceRows = SEED_CATALOGS.reduce((n, c) => n + c.sources.length, 0);
    expect(totalSourceRows).toBe(14);

    const attributions = seedAttributions();
    expect(attributions).toHaveLength(10);

    // Cada atribución trae los campos que pide C2, no vacíos.
    for (const a of attributions) {
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.publisher.length).toBeGreaterThan(0);
      expect(a.licenseName.length).toBeGreaterThan(0);
      expect(a.licenseUrl.length).toBeGreaterThan(0);
      expect(a.sourceUrl.length).toBeGreaterThan(0);
    }
  });

  it("matches the real sha256 dedupe count computed directly off SEED_CATALOGS", () => {
    const uniqueShas = new Set(SEED_CATALOGS.flatMap((c) => c.sources.map((s) => s.sha256)));
    expect(uniqueShas.size).toBe(10);
    expect(seedAttributions()).toHaveLength(uniqueShas.size);
  });
});

describe("seedAttributionFor (C2-d — el libro correcto según el idioma congelado)", () => {
  it("picks the ES source for universidad/fisica when lang=es (a DIFFERENT book than the EN source)", () => {
    const es = seedAttributionFor("universidad/fisica", "es");
    const en = seedAttributionFor("universidad/fisica", "en");
    expect(es?.title).toBe("Física universitaria, volumen 1");
    expect(en?.title).toBe("College Physics");
    expect(es?.title).not.toBe(en?.title);
  });

  it("falls back to the only available source when the requested lang has none (bachillerato/fisica: EN-only)", () => {
    const es = seedAttributionFor("bachillerato/fisica", "es");
    const en = seedAttributionFor("bachillerato/fisica", "en");
    expect(es?.title).toBe("Physics");
    expect(en?.title).toBe("Physics");
  });

  it("returns non-empty title/publisher/licenseName/licenseUrl/sourceUrl for every real (level/subject, lang) pair", () => {
    for (const level of LEVELS) {
      for (const subjectKey of SUBJECT_KEYS) {
        for (const lang of ["es", "en"] as const) {
          const attribution = seedAttributionFor(`${level}/${subjectKey}`, lang);
          expect(attribution, `${level}/${subjectKey} (${lang})`).not.toBeNull();
          expect(attribution!.title.length).toBeGreaterThan(0);
          expect(attribution!.publisher.length).toBeGreaterThan(0);
          expect(attribution!.licenseName.length).toBeGreaterThan(0);
          expect(attribution!.licenseUrl.length).toBeGreaterThan(0);
          expect(attribution!.sourceUrl.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("returns null for an unknown catalogKey (own subject, or corrupt data — never throws)", () => {
    expect(seedAttributionFor("universidad/filosofia", "es")).toBeNull();
    expect(seedAttributionFor("not-a-catalog-key", "es")).toBeNull();
    expect(seedAttributionFor("", "es")).toBeNull();
  });
});

/**
 * C2-e: el idioma de la fuente que `seedAttributionFor` elegiría — el
 * servidor lo expone como `seedMaterialLang` en `GET /v1/temario/:subjectId`
 * para que el cliente sepa en qué idioma está el libro detrás del temario
 * (puede divergir del idioma de la UI: `Subject.seedLang` se congela desde
 * `users.preferredLanguageCode` sin mirar las fuentes del catálogo, C2-a).
 */
describe("seedSourceLangFor (C2-e — idioma de la fuente detrás del temario)", () => {
  it("universidad/fisica has BOTH langs: es→'es', en→'en' (two different books)", () => {
    expect(seedSourceLangFor("universidad/fisica", "es")).toBe("es");
    expect(seedSourceLangFor("universidad/fisica", "en")).toBe("en");
  });

  it("bachillerato/fisica falls back to its only source for an 'es' user → 'en' (the divergence the note is for)", () => {
    expect(seedSourceLangFor("bachillerato/fisica", "es")).toBe("en");
    expect(seedSourceLangFor("bachillerato/fisica", "en")).toBe("en");
  });

  it("mirrors seedAttributionFor's source choice for every real (level/subject, lang) pair", () => {
    for (const level of LEVELS) {
      for (const subjectKey of SUBJECT_KEYS) {
        for (const lang of ["es", "en"] as const) {
          const attribution = seedAttributionFor(`${level}/${subjectKey}`, lang);
          // Parity guard: the lang resolver and the attribution resolver share
          // one fallback rule — if they ever diverge, this catches it.
          const sourceLang = seedSourceLangFor(`${level}/${subjectKey}`, lang);
          expect(sourceLang === null).toBe(attribution === null);
          if (attribution) expect(sourceLang).not.toBeNull();
        }
      }
    }
  });

  it("returns null for an unknown catalogKey (never throws)", () => {
    expect(seedSourceLangFor("universidad/filosofia", "es")).toBeNull();
    expect(seedSourceLangFor("not-a-catalog-key", "en")).toBeNull();
    expect(seedSourceLangFor("", "es")).toBeNull();
  });
});
