/**
 * Tests for the provider-agnostic temario tools — Fase P1/P2.
 *
 * P2 FIX2/FIX3 (2026-07-21 post-real-run REVIEW): `subjectId` moved from
 * tool input to `ServerToolContext` (auth-scoped, server-injected — never
 * model-supplied), `createTopic`/`createMilestone` no longer accept a
 * model-chosen `order` (always appended server-side), and repeated calls
 * with an already-used title are idempotent (return the existing row
 * instead of throwing on the DB unique constraint).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import {
  createTopicTool,
  createMilestoneTool,
  executeTemarioTool,
  TEMARIO_TOOLS,
} from "../../src/models/tools/temario-tools";
import { findTemarioBySubject } from "../../src/repositories/temarios";
import type { ServerToolContext } from "../../src/models/tools/types";

describe("models/tools/temario-tools.ts — P1/P2", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  async function fixture() {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, { email: "tools@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
    const course = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    const subject = await createSubject(testDb.db, { userId: user.id, courseId: course.id, name: "Literatura" });
    return { user, subject };
  }

  it("exports the five expected tool definitions", () => {
    const names = TEMARIO_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(["createMilestone", "createTopic", "deleteTopic", "reorderTopics", "updateTopic"].sort());
  });

  // ---------------------------------------------------------------------
  // FIX3 — subjectId comes from ToolContext, not from the model's input.
  // ---------------------------------------------------------------------

  it("FIX3: createTopic's input schema does NOT accept subjectId (a model-supplied subjectId is silently dropped, never used)", () => {
    const parsed = createTopicTool.parameters.parse({ subjectId: "some-other-subject-the-model-made-up", title: "T1" });
    expect(parsed).toEqual({ title: "T1" });
    expect(parsed).not.toHaveProperty("subjectId");
  });

  it("FIX3: createMilestone's input schema does NOT accept subjectId either", () => {
    const parsed = createMilestoneTool.parameters.parse({
      subjectId: "some-other-subject",
      title: "P1",
      kind: "parcial",
      coversUpToTopicTitle: "Tema 1",
    });
    expect(parsed).toEqual({ title: "P1", kind: "parcial", coversUpToTopicTitle: "Tema 1" });
  });

  it("FIX3: a model cannot redirect a write to another subject — ctx.subjectId wins even if the input tries to name a different one", async () => {
    const { user, subject: subjectA } = await fixture();
    const subjectB = await createSubject(testDb.db, { userId: user.id, courseId: (await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" })).id, name: "Matemática" });

    const ctx: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subjectA.id };
    // Even though the caller passes subjectB's id in the raw args (as a
    // model with the OLD contract might have tried), the tool's schema
    // drops it — the write lands under ctx.subjectId (subjectA), never subjectB.
    await executeTemarioTool(ctx, "createTopic", { subjectId: subjectB.id, title: "Redirigido?" });

    const temarioA = await findTemarioBySubject(testDb.db, subjectA.id);
    const temarioB = await findTemarioBySubject(testDb.db, subjectB.id);
    expect(temarioA!.topics).toHaveLength(1);
    expect(temarioA!.topics[0]!.title).toBe("Redirigido?");
    expect(temarioB).toBeNull();
  });

  it("createTopic writes a topic within the caller's scope", async () => {
    const { user, subject } = await fixture();
    const ctx: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subject.id };
    const topic = await executeTemarioTool(ctx, "createTopic", { title: "Género lírico" });
    expect((topic as { title: string }).title).toBe("Género lírico");

    const temario = await findTemarioBySubject(testDb.db, subject.id);
    expect(temario!.topics).toHaveLength(1);
  });

  it("createTopic with a different user's subject does not write", async () => {
    const { subject } = await fixture();
    expect(await findTemarioBySubject(testDb.db, subject.id)).toBeNull();

    const intruder = await createUser(testDb.db, { email: "intruder@example.com", displayName: "B", ageConfirmedAt: new Date().toISOString() });
    const ctx: ServerToolContext = { db: testDb.db, userId: intruder.id, subjectId: subject.id };

    await expect(executeTemarioTool(ctx, "createTopic", { title: "X" })).rejects.toThrow(
      "subject_not_found_or_not_owned",
    );

    expect(await findTemarioBySubject(testDb.db, subject.id)).toBeNull();
  });

  it("simulates a model loop that creates multiple topics and a milestone", async () => {
    const { user, subject } = await fixture();
    const ctx: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subject.id };

    const calls = [
      { tool: "createTopic", args: { title: "T1" } },
      { tool: "createTopic", args: { title: "T2" } },
      { tool: "createTopic", args: { title: "T3" } },
      { tool: "createMilestone", args: { title: "P1", kind: "parcial", coversUpToTopicTitle: "T3" } },
    ];

    for (const call of calls) {
      await executeTemarioTool(ctx, call.tool, call.args);
    }

    const temario = await findTemarioBySubject(testDb.db, subject.id);
    expect(temario!.topics).toHaveLength(3);
    expect(temario!.topics.map((t) => t.order)).toEqual([0, 1, 2]);
    expect(temario!.milestones).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // FIX2 — server-assigned order + idempotent dedup by title.
  // ---------------------------------------------------------------------

  it("FIX2: order is always server-assigned — a model-supplied order in the input is ignored", async () => {
    const { user, subject } = await fixture();
    const ctx: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subject.id };

    // Both calls "ask" for order 0 (as a confused/duplicating model might) —
    // the input schema has no `order` field at all, so it can't even be sent.
    await executeTemarioTool(ctx, "createTopic", { title: "Primero" });
    await executeTemarioTool(ctx, "createTopic", { title: "Segundo" });

    const temario = await findTemarioBySubject(testDb.db, subject.id);
    expect(temario!.topics.map((t) => ({ title: t.title, order: t.order }))).toEqual([
      { title: "Primero", order: 0 },
      { title: "Segundo", order: 1 },
    ]);
  });

  it("FIX2: a duplicate createTopic call (same title) is idempotent — returns the existing topic, does not throw or double-create", async () => {
    const { user, subject } = await fixture();
    const ctx: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subject.id };

    const first = await executeTemarioTool(ctx, "createTopic", { title: "Estructura atómica" });
    const second = await executeTemarioTool(ctx, "createTopic", { title: "Estructura atómica" });

    expect((second as { id: string }).id).toBe((first as { id: string }).id);

    const temario = await findTemarioBySubject(testDb.db, subject.id);
    expect(temario!.topics).toHaveLength(1);
  });

  it("FIX2: dedup is case/whitespace-insensitive", async () => {
    const { user, subject } = await fixture();
    const ctx: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subject.id };

    await executeTemarioTool(ctx, "createTopic", { title: "Cinética química" });
    await executeTemarioTool(ctx, "createTopic", { title: "  cinética química  " });

    const temario = await findTemarioBySubject(testDb.db, subject.id);
    expect(temario!.topics).toHaveLength(1);
  });

  it("FIX2: a duplicate createMilestone call (same title) is idempotent too", async () => {
    const { user, subject } = await fixture();
    const ctx: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subject.id };
    await executeTemarioTool(ctx, "createTopic", { title: "T1" });

    const first = await executeTemarioTool(ctx, "createMilestone", { title: "Parcial 1", kind: "parcial", coversUpToTopicTitle: "T1" });
    const second = await executeTemarioTool(ctx, "createMilestone", { title: "Parcial 1", kind: "parcial", coversUpToTopicTitle: "T1" });
    expect((second as { id: string }).id).toBe((first as { id: string }).id);

    const temario = await findTemarioBySubject(testDb.db, subject.id);
    expect(temario!.milestones).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // Bugfix (2026-07-25, post-M3-smoke REVIEW) — createMilestone names the
  // last covered topic instead of guessing its numeric order. This is the
  // mechanism-level test for the structural fix: it must resolve to the
  // topic's REAL order even when that doesn't match a naive index count.
  // ---------------------------------------------------------------------

  it("BUGFIX: createMilestone resolves coversUpToTopicTitle to the NAMED topic's real order, not a guessed index", async () => {
    const { user, subject } = await fixture();
    const ctx: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subject.id };

    // Reproduces the exact M3 smoke shape: 5 topics created, and the model
    // wants a milestone that covers up to and including "Enlace químico"
    // (order 4) — the topic the real bug silently EXCLUDED because the model
    // guessed coversUpToOrder=3 instead of counting correctly to 4.
    await executeTemarioTool(ctx, "createTopic", { title: "Estructura atómica" });
    await executeTemarioTool(ctx, "createTopic", { title: "Termodinámica de la reacción química" });
    await executeTemarioTool(ctx, "createTopic", { title: "Equilibrios iónicos en disolución" });
    await executeTemarioTool(ctx, "createTopic", { title: "Tabla Periódica y propiedades periódicas" });
    await executeTemarioTool(ctx, "createTopic", { title: "Enlace químico: teorías y tipos" });

    const milestone = await executeTemarioTool(ctx, "createMilestone", {
      title: "Parcial 1: Estructura y enlaces",
      kind: "parcial",
      coversUpToTopicTitle: "Enlace químico: teorías y tipos",
    });

    expect((milestone as { coversUpToOrder: number }).coversUpToOrder).toBe(4);
  });

  it("BUGFIX: createMilestone with a title matching no topic fails with an actionable error listing the real topics", async () => {
    const { user, subject } = await fixture();
    const ctx: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subject.id };
    await executeTemarioTool(ctx, "createTopic", { title: "Estructura atómica" });
    await executeTemarioTool(ctx, "createTopic", { title: "Enlace químico" });

    await expect(
      executeTemarioTool(ctx, "createMilestone", {
        title: "Parcial 1",
        kind: "parcial",
        coversUpToTopicTitle: "Tema que no existe",
      }),
    ).rejects.toThrow(/milestone_covers_topic_not_found.*Tema que no existe.*Estructura atómica.*Enlace químico/s);

    const temario = await findTemarioBySubject(testDb.db, subject.id);
    expect(temario!.milestones).toHaveLength(0);
  });

  it("FIX2: reproduces the exact real-run bug scenario — 10 topics then a duplicate of the first — and survives", async () => {
    const { user, subject } = await fixture();
    const ctx: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subject.id };

    const titles = [
      "Estructura atómica",
      "Tabla Periódica y propiedades periódicas",
      "Enlace químico: teorías y tipos",
      "Estados de agregación de la materia",
      "Cinética química",
      "Química nuclear",
      "Grupos funcionales orgánicos",
      "Termodinámica química",
      "Termodinámica de la reacción química",
      "Equilibrios iónicos en disolución",
    ];

    for (const title of titles) {
      await executeTemarioTool(ctx, "createTopic", { title });
    }

    // The real bug: the model repeated the FIRST createTopic call verbatim
    // (same title, and in the old contract, the same explicit order: 0)
    // after all 10 were already committed.
    await expect(executeTemarioTool(ctx, "createTopic", { title: titles[0] })).resolves.toBeDefined();

    const temario = await findTemarioBySubject(testDb.db, subject.id);
    expect(temario!.topics).toHaveLength(10);
    expect(temario!.topics.map((t) => t.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  // ---------------------------------------------------------------------
  // FIX3 (continued) — updateTopic/deleteTopic stay scoped to userId AND subjectId.
  // ---------------------------------------------------------------------

  it("FIX3: updateTopic/deleteTopic reject a topic that belongs to a DIFFERENT subject of the SAME user (context subjectId mismatch)", async () => {
    const { user, subject: subjectA } = await fixture();
    const courseB = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    const subjectB = await createSubject(testDb.db, { userId: user.id, courseId: courseB.id, name: "Física" });

    const ctxA: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subjectA.id };
    const topicInA = (await executeTemarioTool(ctxA, "createTopic", { title: "Tema A" })) as { id: string };

    // Same user, but this tool-calling session is scoped to subjectB — must
    // NOT be able to update/delete a topic that lives under subjectA.
    const ctxB: ServerToolContext = { db: testDb.db, userId: user.id, subjectId: subjectB.id };
    await expect(executeTemarioTool(ctxB, "updateTopic", { topicId: topicInA.id, title: "Hijacked" })).rejects.toThrow(
      "topic_not_found_or_not_owned",
    );
    await expect(executeTemarioTool(ctxB, "deleteTopic", { topicId: topicInA.id })).rejects.toThrow(
      "topic_not_found_or_not_owned",
    );
  });
});
