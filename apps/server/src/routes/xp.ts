/**
 * XP read routes — Fase P1.
 *
 * XP events are only written by the assessor-driven mastery flow; these
 * routes expose read-only totals scoped to the authenticated user. In shadow
 * mode, stars and XP totals are omitted from the client payload (antifuga).
 */
import { Hono } from "hono";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";
import { findSubjectById } from "../repositories/subjects";
import { computeXpTotals, getXpTotal, listXpEventsByUser, readXpDemotionPolicy } from "../repositories/xp";

/** Antifuga helper: in shadow mode, strip numeric XP and the event ledger from the payload. Always keep `visibility`. */
function applyXpVisibility<T extends { total?: number; visible?: number; raw?: number; events?: unknown[] }>(
  payload: T,
  visibility: "shadow" | "visible",
): (Omit<T, "total" | "visible" | "raw" | "events"> & { visibility: "shadow" | "visible" }) | (T & { visibility: "shadow" | "visible" }) {
  if (visibility === "shadow") {
    const { total: _total, visible: _visible, raw: _raw, events: _events, ...rest } = payload;
    void _total;
    void _visible;
    void _raw;
    void _events;
    return { ...rest, visibility };
  }
  return { ...payload, visibility };
}

export function createXpRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/:subjectId?", async (c) => {
    const userId = c.get("userId");
    const subjectId = c.req.param("subjectId");

    if (subjectId) {
      const subject = await findSubjectById(deps.db, subjectId);
      if (!subject || subject.userId !== userId) return errorResponse(c, "not_found", "Subject not found");
    }

    const events = await listXpEventsByUser(deps.db, userId, subjectId ? { subjectId } : undefined);
    const raw = events.reduce((sum, e) => sum + e.delta, 0);

    const policy = readXpDemotionPolicy(deps.env.BUXO_XP_DEMOTION_POLICY);
    const totals = computeXpTotals(events, policy);

    const payload = {
      raw,
      visible: totals.visible,
      policy,
      subjectId: subjectId ?? null,
      events,
    };

    return c.json(applyXpVisibility(payload, deps.env.MASTERY_VISIBILITY_MODE));
  });

  app.get("/:subjectId/total", async (c) => {
    const userId = c.get("userId");
    const subjectId = c.req.param("subjectId");
    const subject = await findSubjectById(deps.db, subjectId);
    if (!subject || subject.userId !== userId) return errorResponse(c, "not_found", "Subject not found");

    const total = await getXpTotal(deps.db, userId, subjectId);
    const policy = readXpDemotionPolicy(deps.env.BUXO_XP_DEMOTION_POLICY);

    const payload = { total, policy, subjectId };
    return c.json(applyXpVisibility(payload, deps.env.MASTERY_VISIBILITY_MODE));
  });

  return app;
}
