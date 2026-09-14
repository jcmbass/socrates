/**
 * GET /v1/seed/subjects, GET /v1/seed/attributions — catálogo seed de
 * temarios (`01-plan-c0.md` ADENDA §(a)/(b), C2-a).
 *
 * Datos públicos de catálogo, montados SIN auth (`app.ts` no agrega
 * "/v1/seed/*" a la lista de rutas detrás de `requireAuth`), a propósito:
 * ninguna de las dos rutas lee ni escribe nada de `userId` — son un espejo
 * de `packages/domain/data/seed/**`, el mismo material abierto (CC BY) que
 * ya vive en el repo del servidor. Mismo patrón que `/legal/*`
 * (`routes/legal.ts`): páginas/documentos que no dependen de una sesión.
 * Si algún día esto necesita distinguirse por usuario (p.ej. filtrar por
 * materias ya activadas), esa lógica va en `/v1/courses/:courseId/...`
 * (donde SÍ hay auth), no acá.
 *
 * `apps/mobile` NO debe importar `@buxo/domain/seed-catalog` ni
 * `@buxo/domain/data/seed` (ver el docblock de `seed-catalog.ts`: ~1.1 MB
 * de JSON que engordarían el bundle) — el cliente consume estos dos
 * endpoints y nada más.
 */
import { Hono } from "hono";
import { SEED_CATALOGS } from "@buxo/domain/data/seed";
import { SeedLevelSchema, seedAttributions } from "@buxo/domain/seed-catalog";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";

/** Sum of every unit's topic count for one language's syllabus — the number the onboarding step-2 chip shows. */
function topicCount(units: { topics: string[] }[]): number {
  return units.reduce((sum, unit) => sum + unit.topics.length, 0);
}

export function createSeedRoutes(_deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /v1/seed/subjects?level=bachillerato|universidad — the 5 seed
  // subjects for that level, with unit/topic counts per language so the
  // client can render "236 temas" without fetching the full catalog.
  app.get("/subjects", (c) => {
    const parsedLevel = SeedLevelSchema.safeParse(c.req.query("level"));
    if (!parsedLevel.success) {
      return errorResponse(c, "invalid_request", 'level must be "bachillerato" or "universidad"');
    }
    const level = parsedLevel.data;

    const result = SEED_CATALOGS.filter((catalog) => catalog.level === level).map((catalog) => ({
      level: catalog.level,
      subjectKey: catalog.subject_key,
      name: catalog.subject_name,
      unitCount: { es: catalog.syllabus.es.length, en: catalog.syllabus.en.length },
      topicCount: { es: topicCount(catalog.syllabus.es), en: topicCount(catalog.syllabus.en) },
    }));
    return c.json(result);
  });

  // GET /v1/seed/attributions — the 10 unique books (CC BY etc.), for the
  // "Atribuciones" screen (ADENDA §(b), R-1: CC BY requires attribution
  // wherever the derived work — here, the temario structure — is distributed).
  app.get("/attributions", (c) => c.json(seedAttributions()));

  return app;
}
