/**
 * GET /v1/mastery/:subjectId — C-backend §2.4:
 *   "SOLO si visibility:'visible' — 404/oculto mientras esté en shadow, no
 *   expuesto siquiera con un campo 'hidden:true' que revele que existe"
 *
 * B2-motor-de-dominio.md §5.1: `MasteryState` rows DO exist now (F2 WQ3
 * parte B3, `mastery/aggregate.ts` writes them after every Assessment) —
 * this route's 404 is no longer "literally nothing exists", it's the real
 * shadow gate: `MASTERY_VISIBILITY_MODE` is `"shadow"` for the whole beta
 * (O-5), so the student route stays 404 regardless of what's computed
 * underneath. Ownership (subject belongs to the caller) is still checked
 * first so a 404 doesn't leak whether an arbitrary subjectId string exists
 * at all — same discipline as before, just for a real reason now.
 *
 * GET /:subjectId/inspect (F2 WQ3 parte B4, B2 §5.2) is the founder-only
 * escape hatch: `accountKind === "internal_dev"` sees everything (states +
 * full history + unmaterialized topic counts) REGARDLESS of shadow — for
 * ANYONE else it returns the exact same not_found response as the student
 * route (never distinguishes "not internal_dev" from "not found" — same
 * anti-enumeration discipline C-backend §2.4 already applies elsewhere).
 *
 * DEVIATION (flagged for architect review): this route scopes `/inspect` to
 * subjects the CALLING internal_dev account itself owns (same
 * `subject.userId !== userId` check every other route in this file uses) —
 * it does NOT let a founder inspect an arbitrary STUDENT's subject. B2 §5.2
 * describes the founder auditing a sample of real student trajectories,
 * which needs a materially different route shape (no `userId` param exists
 * on this path at all today). Building that cross-user surface felt like
 * scope creep past "B4: founder-only inspection tool" as scoped for F2 WQ3
 * — the conservative call here is an internal_dev account exercising its
 * OWN test subjects end-to-end (exactly how F2's fakes-only shadow testing
 * already works), not a new admin surface. Revisit if real cross-user
 * auditing is needed before the F4 shadow-exit criteria (B2 §5.3) are
 * evaluated.
 */
import { Hono } from "hono";
import type { AppDeps } from "../deps";
import type { AuthVariables } from "../auth/middleware";
import { errorResponse } from "../errors";
import { findSubjectById } from "../repositories/subjects";
import { findUserById } from "../repositories/users";
import { listMasteryHistoryByState, listMasteryStatesBySubject } from "../repositories/mastery";
import { countAssessmentsGroupedByTopicKey } from "../repositories/assessments";
import { getXpTotal } from "../repositories/xp";
import { projectMasteryVisibility, tierToStars } from "@buxo/domain/mastery";
import { SUBJECT_ROLLUP_TOPIC_KEY } from "@buxo/domain/sentinels";

export function createMasteryRoutes(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/:subjectId", async (c) => {
    const userId = c.get("userId");
    const subject = await findSubjectById(deps.db, c.req.param("subjectId"));
    if (!subject || subject.userId !== userId) return errorResponse(c, "not_found", "Not found");

    // O-5: in shadow mode the student-facing route never reads MasteryState,
    // on purpose (§5.1: "no se muestra" must not become "se manda pero se esconde").
    if (deps.env.MASTERY_VISIBILITY_MODE === "shadow") {
      return errorResponse(c, "not_found", "Not found");
    }

    const states = await listMasteryStatesBySubject(deps.db, userId, subject.id);
    const statesWithXp = await Promise.all(
      states.map(async (state) => {
        const xp = state.topicId ? await getXpTotal(deps.db, userId, subject.id) : await getXpTotal(deps.db, userId, subject.id);
        const payload = {
          ...state,
          stars: tierToStars(state.currentLevel.tier),
          xp,
        };
        return projectMasteryVisibility(payload, "visible");
      }),
    );
    return c.json({ states: statesWithXp });
  });

  app.get("/:subjectId/inspect", async (c) => {
    const userId = c.get("userId");
    const notFound = () => errorResponse(c, "not_found", "Not found");

    // accountKind gate FIRST — a non-internal_dev caller never even triggers a subject lookup (no existence-leak via timing/query, B2 §5.2).
    const user = await findUserById(deps.db, userId);
    if (!user || user.accountKind !== "internal_dev") return notFound();

    const subjectId = c.req.param("subjectId");
    const subject = await findSubjectById(deps.db, subjectId);
    if (!subject || subject.userId !== userId) return notFound();

    const states = await listMasteryStatesBySubject(deps.db, userId, subjectId);
    const statesWithHistory = await Promise.all(
      states.map(async (state) => ({
        ...state,
        history: await listMasteryHistoryByState(deps.db, userId, subjectId, state.topicKey),
      })),
    );

    const materializedTopicKeys = new Set(states.map((s) => s.topicKey).filter((k) => k !== SUBJECT_ROLLUP_TOPIC_KEY));
    const topicCounts = await countAssessmentsGroupedByTopicKey(deps.db, subjectId);
    const unmaterializedTopicCounts = topicCounts.filter((t) => !materializedTopicKeys.has(t.topicKey));

    return c.json({ states: statesWithHistory, unmaterializedTopicCounts });
  });

  return app;
}
