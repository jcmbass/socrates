/**
 * Localización de la sesión guiada (bug del 2026-09-18, tester en inglés).
 *
 * Reporte: la UI de la app en inglés, pero «las preguntas del tutor y las
 * explicaciones» en español. El chat del tutor SÍ estaba cableado
 * (`routes/sessions.ts` → `getSystemPrompt(..., { locale })`, congelado en
 * `sessions-locale.test.ts`); los ítems de la sesión guiada NO: el generador
 * usaba un prompt en español fijo, sin ninguna noción de locale, y el batch
 * quedaba cacheado en `topic_items` sin registrar en qué idioma se generó.
 *
 * Reglas que estos tests congelan:
 *   - locale "en" → el system prompt del generador pide inglés explícito y
 *     las opciones de verdadero_falso pasan a True/False (el schema de
 *     validación las exige, así que tiene que ser el mismo par en los dos
 *     lados).
 *   - locale "es" (el default de toda la base instalada) → render
 *     BYTE-IDÉNTICO al histórico y el MISMO objeto de schema, patrón AJUSTE 4
 *     de `sessions-locale.test.ts`.
 *   - un cambio de idioma invalida el batch cacheado (se regenera una vez);
 *     el mismo idioma no vuelve a llamar al modelo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app";
import { buildTestDeps, type TestContext } from "../support/test-deps";
import { signupAndVerify } from "../support/signup";
import { readJson } from "../support/json";
import type { CourseBody, SubjectBody } from "../support/http-types";
import { topicItems } from "../../src/db/schema";
import { parseTopicItemsPayload } from "@buxo/domain/guided-item";
import {
  GeneratedGuidedBatchSchema,
  GUIDED_ITEMS_SYSTEM_PROMPT,
  guidedItemsSystemPrompt,
} from "../../src/guided/generate-topic-items";

interface TopicBody {
  id: string;
  title: string;
}

describe("guided items — wiring de preferredLanguageCode al generador", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.testDb.close();
  });

  async function setup(email: string, locale?: "en") {
    ctx = await buildTestDeps({ envOverrides: { BUXO_FAKE_MODELS: true } });
    const app = createApp(ctx.deps);
    const { token } = await signupAndVerify(app, ctx.deps, email);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    if (locale) {
      const patched = await app.request("/v1/me", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ preferredLanguageCode: locale }),
      });
      expect(patched.status).toBe(204);
    }

    const course = await readJson<CourseBody>(
      await app.request("/v1/courses", {
        method: "POST",
        headers,
        body: JSON.stringify({ gradeLevelId: "sv-bachillerato-1" }),
      }),
    );
    const subject = await readJson<SubjectBody>(
      await app.request("/v1/subjects", {
        method: "POST",
        headers,
        body: JSON.stringify({ courseId: course.id, name: "Física" }),
      }),
    );
    const topic = await readJson<TopicBody>(
      await app.request(`/v1/temario/${subject.id}/topics`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Movimiento rectilíneo" }),
      }),
    );

    const ensurePath = `/v1/subjects/${subject.id}/topics/${topic.id}/items:ensure`;
    return { app, headers, subject, topic, ensurePath };
  }

  it("locale 'en': el generador recibe el prompt en inglés y el schema de True/False", async () => {
    const { app, headers, ensurePath, topic } = await setup("guided-locale-en@example.com", "en");
    const spy = vi.spyOn(ctx.deps.models.structuredAdapter, "generateStructured");

    const res = await app.request(ensurePath, { method: "POST", headers });
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledTimes(1);
    const params = spy.mock.calls[0]![0];
    expect(params.system).toBe(guidedItemsSystemPrompt("en"));
    expect(params.system).toMatch(/in English/);
    expect(params.system).toMatch(/True\/False|True o False|exactly True or False/);
    expect(params.system).not.toBe(GUIDED_ITEMS_SYSTEM_PROMPT);
    expect(params.schema).not.toBe(GeneratedGuidedBatchSchema);

    // El idioma con el que se generó queda registrado en la fila cacheada:
    // sin eso, un cambio de idioma serviría para siempre el batch viejo.
    const [row] = await ctx.deps.db.select().from(topicItems).where(eq(topicItems.topicId, topic.id)).limit(1);
    expect(parseTopicItemsPayload(row!.payload).locale).toBe("en");
  });

  it("locale 'es' (default): render byte-idéntico y el MISMO objeto de schema", async () => {
    const { app, headers, ensurePath } = await setup("guided-locale-es@example.com");
    const spy = vi.spyOn(ctx.deps.models.structuredAdapter, "generateStructured");

    const res = await app.request(ensurePath, { method: "POST", headers });
    expect(res.status).toBe(200);

    const params = spy.mock.calls[0]![0];
    expect(params.system).toBe(GUIDED_ITEMS_SYSTEM_PROMPT);
    expect(params.system).not.toMatch(/in English/);
    expect(params.schema).toBe(GeneratedGuidedBatchSchema);
  });

  it("cambiar de idioma regenera el batch una vez; el mismo idioma no vuelve a llamar al modelo", async () => {
    const { app, headers, ensurePath, topic } = await setup("guided-locale-switch@example.com");
    const spy = vi.spyOn(ctx.deps.models.structuredAdapter, "generateStructured");

    await app.request(ensurePath, { method: "POST", headers });
    expect(spy).toHaveBeenCalledTimes(1);

    // Mismo idioma: cache hit, cero llamadas nuevas.
    await app.request(ensurePath, { method: "POST", headers });
    expect(spy).toHaveBeenCalledTimes(1);

    const patched = await app.request("/v1/me", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ preferredLanguageCode: "en" }),
    });
    expect(patched.status).toBe(204);

    const afterSwitch = await app.request(ensurePath, { method: "POST", headers });
    expect(afterSwitch.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]![0].system).toBe(guidedItemsSystemPrompt("en"));

    const rows = await ctx.deps.db.select().from(topicItems).where(eq(topicItems.topicId, topic.id));
    expect(rows).toHaveLength(1);
    expect(parseTopicItemsPayload(rows[0]!.payload).locale).toBe("en");

    // Y una vez regenerado en inglés, vuelve a ser cache hit.
    await app.request(ensurePath, { method: "POST", headers });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
