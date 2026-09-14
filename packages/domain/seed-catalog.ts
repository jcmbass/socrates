/**
 * Seed catalogs — temarios por nivel académico (bachillerato/universidad)
 * cargados desde material abierto (CC BY / CC BY-SA / dominio público),
 * recolectado y validado fuera del repo por la pista `buxo-seed`
 * (D-C05 en `docs/plan-onboarding-seed/00-decisiones.md`).
 *
 * Igual que `education-catalog.ts`: los tipos y el zod de `SeedCatalog` son
 * SHAPE puro. Los datos viven aparte, en `data/seed/index.ts` (que importa
 * los 10 JSON de `data/seed/<nivel>/<materia>.json` — copias
 * byte-idénticas del catálogo de origen). Única diferencia deliberada con
 * ese patrón: `seedSubjectsForLevel`/`seedAttributions` sí importan
 * `SEED_CATALOGS` de `./data/seed`, porque el plan (`01-plan-c0.md` §2)
 * pide que salgan de los datos reales y nunca se escriban a mano — son
 * derivados, no shape.
 *
 * Alcance de C1-a (ver ADENDA §(a) de `01-plan-c0.md`): sólo el TEMARIO
 * entra al producto. Los PDFs (774 MB) NO están en el repo — `pdf_path` es
 * un dato informativo del catálogo de origen, apuntando a una ruta fuera
 * del repo; ningún código de este paquete ni de sus tests debe abrirlo.
 * La ingesta del material (`seed_fuentes`) queda pospuesta hasta que exista
 * recuperación (RAG) — no se modela aquí.
 *
 * RESTRICCIÓN DE DISEÑO: `apps/mobile` NO debe importar este módulo ni
 * `./data/seed` — son ~1.1 MB de JSON entre los 10 catálogos y engordarían
 * el bundle/APK para datos que el cliente no necesita completos. El
 * servidor los expone por API (fase C2); el móvil consume esa API, no el
 * paquete de datos directamente.
 *
 * Pureza de `@buxo/domain` (ver su `package.json`): sin DB, sin SQL, sin
 * Node built-ins, sin DOM, sin React. Los JSON se importan como módulos
 * (`resolveJsonModule` en `tsconfig.json`), nunca leídos con `fs`.
 */
import { z } from "zod";
import { SEED_CATALOGS } from "./data/seed";

/** Los dos niveles académicos del seed (D-C01). */
export type SeedLevel = "bachillerato" | "universidad";

export const SeedLevelSchema: z.ZodType<SeedLevel> = z.enum(["bachillerato", "universidad"]);

/** Las cinco materias del seed, por nivel (D-C01). */
export type SeedSubjectKey = "matematicas" | "fisica" | "quimica" | "biologia" | "economia";

export const SeedSubjectKeySchema: z.ZodType<SeedSubjectKey> = z.enum([
  "matematicas",
  "fisica",
  "quimica",
  "biologia",
  "economia",
]);

/** Idioma de una fuente o de un syllabus del catálogo. */
export type SeedLang = "en" | "es";

export const SeedLangSchema: z.ZodType<SeedLang> = z.enum(["en", "es"]);

/** Licencia abierta declarada por una fuente (ver `buxo-seed/README.md` — "Regla de licencias"). */
export interface SeedLicense {
  /** Nombre limpio, p.ej. "CC BY 4.0" (matices en `SeedSource.notes` del catálogo, si los hay). */
  name: string;
  url: string;
  /** URL donde se verificó la licencia vigente (portada del PDF o página oficial). */
  license_declaration_url: string;
}

export const SeedLicenseSchema: z.ZodType<SeedLicense> = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  license_declaration_url: z.string().min(1),
});

/** Rango de páginas del índice/tabla de contenidos dentro del PDF de origen. */
export interface SeedTocPages {
  from: number;
  to: number;
}

export const SeedTocPagesSchema: z.ZodType<SeedTocPages> = z.object({
  from: z.number().int().min(1),
  to: z.number().int().min(1),
});

/**
 * Una fuente (libro) citada por un catálogo. `pdf_path` es la ruta relativa
 * dentro de `buxo-seed/` en la máquina donde se validó/ingirió — NO existe
 * dentro de este repo y ningún consumidor de este paquete debe intentar
 * abrirla.
 */
export interface SeedSource {
  lang: SeedLang;
  title: string;
  publisher: string;
  edition_or_year: string;
  license: SeedLicense;
  source_url: string;
  pdf_url: string;
  pdf_path: string;
  pdf_pages: number;
  pdf_size_mb: number;
  toc_pages: SeedTocPages;
  /** SHA-256 (64 hex) del PDF de origen — identifica el binario, no el catálogo. */
  sha256: string;
}

export const SeedSourceSchema: z.ZodType<SeedSource> = z.object({
  lang: SeedLangSchema,
  title: z.string().min(1),
  publisher: z.string().min(1),
  edition_or_year: z.string().min(1),
  license: SeedLicenseSchema,
  source_url: z.string().min(1),
  pdf_url: z.string().min(1),
  pdf_path: z.string().min(1),
  pdf_pages: z.number().int().min(1),
  pdf_size_mb: z.number().positive(),
  toc_pages: SeedTocPagesSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Una unidad del temario: título de unidad/capítulo + sus temas. */
export interface SeedSyllabusUnit {
  unit: string;
  topics: string[];
}

export const SeedSyllabusUnitSchema: z.ZodType<SeedSyllabusUnit> = z.object({
  unit: z.string().min(1),
  topics: z.array(z.string().min(1)).min(1),
});

/** El temario completo de un catálogo, por idioma. */
export interface SeedSyllabus {
  en: SeedSyllabusUnit[];
  es: SeedSyllabusUnit[];
}

export const SeedSyllabusSchema: z.ZodType<SeedSyllabus> = z.object({
  en: z.array(SeedSyllabusUnitSchema).min(1),
  es: z.array(SeedSyllabusUnitSchema).min(1),
});

/** Nombre localizado de una materia. */
export interface SeedSubjectName {
  es: string;
  en: string;
}

export const SeedSubjectNameSchema: z.ZodType<SeedSubjectName> = z.object({
  es: z.string().min(1),
  en: z.string().min(1),
});

/**
 * Un catálogo seed: `<nivel>/<materia>.json`. Esquema calcado del de
 * `buxo-seed/README.md` ("Esquema de catálogo"), verificado contra los 10
 * JSON reales.
 */
export interface SeedCatalog {
  level: SeedLevel;
  subject_key: SeedSubjectKey;
  subject_name: SeedSubjectName;
  sources: SeedSource[];
  syllabus: SeedSyllabus;
  notes: string;
}

export const SeedCatalogSchema: z.ZodType<SeedCatalog> = z.object({
  level: SeedLevelSchema,
  subject_key: SeedSubjectKeySchema,
  subject_name: SeedSubjectNameSchema,
  sources: z.array(SeedSourceSchema).min(1),
  syllabus: SeedSyllabusSchema,
  notes: z.string(),
});

/** Materia seed disponible para un nivel — lo que el paso 2 del onboarding (C2) necesita listar. */
export interface SeedSubjectSummary {
  level: SeedLevel;
  subjectKey: SeedSubjectKey;
  name: SeedSubjectName;
}

/**
 * Deriva las materias seed de un nivel a partir de `SEED_CATALOGS`
 * (`./data/seed`) — nunca escritas a mano, para no desincronizarse del
 * catálogo real cuando cambie.
 */
export function seedSubjectsForLevel(level: SeedLevel): SeedSubjectSummary[] {
  return SEED_CATALOGS.filter((catalog) => catalog.level === level).map((catalog) => ({
    level: catalog.level,
    subjectKey: catalog.subject_key,
    name: catalog.subject_name,
  }));
}

/** Atribución de un libro único — lo que la pantalla "Atribuciones" (C2) necesita listar. */
export interface SeedAttribution {
  title: string;
  publisher: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
}

/**
 * Deduplica las fuentes de `SEED_CATALOGS` por `sha256` — varios catálogos
 * pueden citar el mismo binario (patrón "Economía": el recorte de
 * bachillerato reusa el PDF universitario), pero es un solo libro a
 * atribuir. El orden de salida sigue la primera aparición al recorrer
 * `SEED_CATALOGS` en su orden de módulo (`./data/seed`).
 */
export function seedAttributions(): SeedAttribution[] {
  const seen = new Map<string, SeedAttribution>();
  for (const catalog of SEED_CATALOGS) {
    for (const source of catalog.sources) {
      if (seen.has(source.sha256)) continue;
      seen.set(source.sha256, {
        title: source.title,
        publisher: source.publisher,
        licenseName: source.license.name,
        licenseUrl: source.license.url,
        sourceUrl: source.source_url,
      });
    }
  }
  return [...seen.values()];
}

/**
 * Atribución de UN catálogo activado en el cliente, en el idioma congelado
 * de esa materia (`Subject.seedLang`) — C2-d. Distinto de `seedAttributions()`
 * (todas las 10, deduplicadas, para la pantalla "Atribuciones"): esto
 * resuelve exactamente el libro correcto para UNA materia, y el libro
 * depende del idioma — `universidad/fisica` en es cita "Física universitaria",
 * en en cita "College Physics" (dos libros distintos, dos `sha256`
 * distintos). Si el catálogo no tiene fuente en `lang` (p.ej.
 * `bachillerato/fisica`, que solo tiene fuente EN aunque su `syllabus.es`
 * exista), cae a la única fuente disponible en vez de devolver `null` —
 * "algo es mejor que nada" para una obligación legal de atribución.
 * `catalogKey` es `Subject.seedCatalogKey` tal cual (`"<nivel>/<materia>"`,
 * p.ej. "universidad/quimica"); un catalogKey desconocido o mal formado
 * devuelve `null` (materia propia, o dato corrupto — nunca lanza).
 *
 * C2-e: `seedSourceLangFor` expone SOLO el idioma de la fuente que esta
 * misma regla elegiría, compartiendo UN resolver interno con
 * `seedAttributionFor` — dos funciones públicas, una sola regla de
 * fallback. El servidor lo usa para decirle al cliente en qué idioma está
 * el libro detrás del temario (`seedMaterialLang`), que puede divergir del
 * idioma de la UI: `Subject.seedLang` se congela desde
 * `users.preferredLanguageCode` sin mirar las fuentes del catálogo
 * (simplificación deliberada de C2-a), así que un usuario `es` con
 * `bachillerato/fisica` (única fuente: "Physics", OpenStax, EN) estudia un
 * temario en español respaldado por un libro en inglés.
 */

/**
 * Resolver interno compartido: la fuente que la regla de atribución
 * elegiría para `(catalogKey, lang)` — la fuente del idioma pedido, o
 * `sources[0]` como fallback cuando el catálogo no la tiene; `null` para
 * catalogKey desconocido/mal formado o catálogo sin fuentes (nunca lanza).
 */
function seedSourceFor(catalogKey: string, lang: SeedLang) {
  const [level, subjectKey] = catalogKey.split("/");
  const catalog = SEED_CATALOGS.find((c) => c.level === level && c.subject_key === subjectKey);
  if (!catalog) return null;
  return catalog.sources.find((s) => s.lang === lang) ?? catalog.sources[0];
}

export function seedAttributionFor(catalogKey: string, lang: SeedLang): SeedAttribution | null {
  const source = seedSourceFor(catalogKey, lang);
  if (!source) return null;
  return {
    title: source.title,
    publisher: source.publisher,
    licenseName: source.license.name,
    licenseUrl: source.license.url,
    sourceUrl: source.source_url,
  };
}

/**
 * El idioma de la fuente que `seedAttributionFor(catalogKey, lang)`
 * elegiría — misma regla de fallback (fuente del `lang` pedido ?? la única
 * fuente disponible), sólo el idioma. `null` para catalogKey desconocido o
 * mal formado (nunca lanza). Consumidor: `routes/temarios.ts` en el
 * `GET /v1/temario/:subjectId` (campo `seedMaterialLang`, C2-e).
 */
export function seedSourceLangFor(catalogKey: string, preferredLang: SeedLang): SeedLang | null {
  return seedSourceFor(catalogKey, preferredLang)?.lang ?? null;
}
