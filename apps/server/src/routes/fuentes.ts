/**
 * Fuente CRUD routes — Fase P1.
 *
 * Fuentes are text-only study materials scoped to (userId, subjectId). The
 * original PDF/image bytes are not stored; only the extracted text is
 * persisted. All write routes enforce user scope via the subject ownership check.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";
import { findSubjectById } from "../repositories/subjects";
import {
  createFuente,
  deleteFuente,
  findFuenteById,
  fuenteBelongsToUser,
  listFuentesBySubject,
  updateFuente,
} from "../repositories/fuentes";

const FuenteBodySchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["pdf", "image"]),
  text: z.string(),
  tokens: z.number().int().min(0).optional(),
});

export function createFuentesRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/:subjectId", async (c) => {
    const userId = c.get("userId");
    const subject = await findSubjectById(deps.db, c.req.param("subjectId"));
    if (!subject || subject.userId !== userId) return errorResponse(c, "not_found", "Subject not found");

    const fuentes = await listFuentesBySubject(deps.db, userId, subject.id);
    return c.json(fuentes);
  });

  app.post("/:subjectId", async (c) => {
    const userId = c.get("userId");
    const subject = await findSubjectById(deps.db, c.req.param("subjectId"));
    if (!subject || subject.userId !== userId) return errorResponse(c, "not_found", "Subject not found");

    const parsed = FuenteBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);

    const fuente = await createFuente(deps.db, {
      userId,
      subjectId: subject.id,
      name: parsed.data.name,
      kind: parsed.data.kind,
      text: parsed.data.text,
      tokens: parsed.data.tokens,
    });
    return c.json(fuente, 201);
  });

  app.get("/:subjectId/:fuenteId", async (c) => {
    const userId = c.get("userId");
    const subject = await findSubjectById(deps.db, c.req.param("subjectId"));
    if (!subject || subject.userId !== userId) return errorResponse(c, "not_found", "Subject not found");

    const fuente = await findFuenteById(deps.db, c.req.param("fuenteId"));
    if (!fuente || fuente.userId !== userId || fuente.subjectId !== subject.id) {
      return errorResponse(c, "not_found", "Fuente not found");
    }
    return c.json(fuente);
  });

  app.patch("/:subjectId/:fuenteId", async (c) => {
    const userId = c.get("userId");
    const subject = await findSubjectById(deps.db, c.req.param("subjectId"));
    if (!subject || subject.userId !== userId) return errorResponse(c, "not_found", "Subject not found");

    const parsed = FuenteBodySchema.partial().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(c, "invalid_request", parsed.error.message);

    const fuente = await findFuenteById(deps.db, c.req.param("fuenteId"));
    if (!fuente || fuente.userId !== userId || fuente.subjectId !== subject.id) {
      return errorResponse(c, "not_found", "Fuente not found");
    }

    const updated = await updateFuente(deps.db, c.req.param("fuenteId"), {
      name: parsed.data.name,
      text: parsed.data.text,
      tokens: parsed.data.tokens,
    });
    if (!updated) return errorResponse(c, "not_found", "Fuente not found");
    return c.json(updated);
  });

  app.delete("/:subjectId/:fuenteId", async (c) => {
    const userId = c.get("userId");
    const owns = await fuenteBelongsToUser(deps.db, c.req.param("fuenteId"), userId);
    if (!owns) return errorResponse(c, "not_found", "Fuente not found");

    await deleteFuente(deps.db, c.req.param("fuenteId"));
    return c.body(null, 204);
  });

  return app;
}
