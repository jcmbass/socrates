/**
 * Repository-level tests for `repositories/temarios.ts` — Fase P1.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import {
  createTemario,
  createTopicInTemario,
  createMilestoneInTemario,
  reorderTopicsInTemario,
  setRecommendedTopic,
  updateTopicInTemario,
  deleteTopicFromTemario,
  updateMilestoneInTemario,
  deleteMilestoneFromTemario,
  findTemarioBySubject,
} from "../../src/repositories/temarios";

describe("repositories/temarios.ts — P1", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  async function fixture() {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, { email: "temario-repo@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
    const course = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    const subject = await createSubject(testDb.db, { userId: user.id, courseId: course.id, name: "Cálculo" });
    return { user, subject };
  }

  it("creates an empty temario and round-trips through findTemarioBySubject", async () => {
    const { user, subject } = await fixture();
    const temario = await createTemario(testDb.db, { userId: user.id, subjectId: subject.id, generatedBy: "manual" });
    expect(temario.userId).toBe(user.id);
    expect(temario.subjectId).toBe(subject.id);
    expect(temario.topics).toEqual([]);
    expect(temario.milestones).toEqual([]);

    const found = await findTemarioBySubject(testDb.db, subject.id);
    expect(found).toEqual(temario);
  });

  it("transactional rollback: a failed reorder leaves topic orders unchanged", async () => {
    const { user, subject } = await fixture();
    const temario = await createTemario(testDb.db, { userId: user.id, subjectId: subject.id });
    const a = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "A" });
    const b = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "B" });

    await expect(
      reorderTopicsInTemario(testDb.db, temario.id, [a.id, "not-a-topic", b.id]),
    ).rejects.toThrow();

    const after = await findTemarioBySubject(testDb.db, subject.id);
    expect(after!.topics.map((t) => ({ id: t.id, order: t.order }))).toEqual([
      { id: a.id, order: 0 },
      { id: b.id, order: 1 },
    ]);
  });

  it("P2 real-API bug #7: reorder survives a non-identity permutation without hitting temas_temario_id_order_unique", async () => {
    // Reproduces the exact 2026-07-21 real Haiku crash: the model created 10
    // topics (append order 0..9), then called reorderTopics with all 10 ids
    // in a genuinely different order (e.g. moving the topic at order 5 to
    // the front). A naive single-pass update sets the first row's order to
    // 0 while a DIFFERENT row still holds order 0 — violating the live
    // unique constraint before the loop ever reaches that other row. This
    // was never exercised by any test/fake before: the only prior reorder
    // test used an invalid id to check rollback, never a real permutation.
    const { user, subject } = await fixture();
    const temario = await createTemario(testDb.db, { userId: user.id, subjectId: subject.id });
    const a = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "A" }); // order 0
    const b = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "B" }); // order 1
    const c = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "C" }); // order 2

    // Move C (currently order 2) to the front while A (currently order 0)
    // stays in the list — the exact "later topic moves to an order another
    // row still holds" shape that crashed the real run.
    const reordered = await reorderTopicsInTemario(testDb.db, temario.id, [c.id, a.id, b.id]);
    expect(reordered.map((t) => ({ id: t.id, order: t.order }))).toEqual([
      { id: c.id, order: 0 },
      { id: a.id, order: 1 },
      { id: b.id, order: 2 },
    ]);

    const after = await findTemarioBySubject(testDb.db, subject.id);
    expect(after!.topics.map((t) => ({ id: t.id, order: t.order }))).toEqual([
      { id: c.id, order: 0 },
      { id: a.id, order: 1 },
      { id: b.id, order: 2 },
    ]);
  });

  it("BUGFIX (2026-07-25, post-M3-smoke): reorderTopics remaps existing milestones to keep covering the SAME topic identity, not the same number", async () => {
    // This is the test that proves the structural bug is dead: a milestone
    // whose `coversUpToOrder` was written BEFORE a reorder must keep
    // pointing at the topic it named at creation time, not at whatever
    // topic happens to hold that numeric position afterward. Before this
    // fix, `reorderTopicsInTemario` only touched `temas.order` — every
    // existing `hitos.coversUpToOrder` silently kept the OLD number, which
    // after the reorder resolved to a DIFFERENT topic (or the wrong scope
    // entirely). This is the "reorder happens after milestones exist" mode
    // of the M3 bug (distinct from the "model miscounts the index at
    // creation time" mode covered in `tools.test.ts`).
    const { user, subject } = await fixture();
    const temario = await createTemario(testDb.db, { userId: user.id, subjectId: subject.id });
    const a = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "A" }); // order 0
    const b = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "B" }); // order 1
    const c = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "C" }); // order 2
    const d = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "D" }); // order 3

    // Milestone covers "up to B" (order 1) at creation time.
    const milestone = await createMilestoneInTemario(testDb.db, {
      temarioId: temario.id,
      kind: "parcial",
      title: "Parcial hasta B",
      coversUpToOrder: 1,
    });
    expect(milestone.coversUpToOrder).toBe(1);

    // Now reorder so D moves to the front: D, A, B, C — B (the topic the
    // milestone actually names) moves from order 1 to order 2.
    await reorderTopicsInTemario(testDb.db, temario.id, [d.id, a.id, b.id, c.id]);

    const after = await findTemarioBySubject(testDb.db, subject.id);
    expect(after!.topics.map((t) => ({ id: t.id, order: t.order }))).toEqual([
      { id: d.id, order: 0 },
      { id: a.id, order: 1 },
      { id: b.id, order: 2 },
      { id: c.id, order: 3 },
    ]);

    const remappedMilestone = after!.milestones.find((m) => m.id === milestone.id)!;
    // The bug: without the fix, this stays 1 — which after the reorder
    // means the milestone's scope is "up to A", silently dropping B, which
    // is what the milestone was actually meant to cover.
    expect(remappedMilestone.coversUpToOrder).toBe(2);
  });

  it("BUGFIX: reorderTopics leaves a milestone's coversUpToOrder unchanged when its covered topic's position doesn't actually move", async () => {
    const { user, subject } = await fixture();
    const temario = await createTemario(testDb.db, { userId: user.id, subjectId: subject.id });
    const a = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "A" }); // order 0
    const b = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "B" }); // order 1
    const c = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "C" }); // order 2

    // Milestone covers "up to A" (order 0) — the topic that will stay first.
    const milestone = await createMilestoneInTemario(testDb.db, {
      temarioId: temario.id,
      kind: "parcial",
      title: "Parcial hasta A",
      coversUpToOrder: 0,
    });

    // Reorder swaps B and C but leaves A in place at order 0.
    await reorderTopicsInTemario(testDb.db, temario.id, [a.id, c.id, b.id]);
    const after = await findTemarioBySubject(testDb.db, subject.id);
    expect(after!.topics.find((t) => t.id === a.id)!.order).toBe(0);

    const remapped = after!.milestones.find((m) => m.id === milestone.id)!;
    expect(remapped.coversUpToOrder).toBe(0);
  });

  it("ensures only one topic per temario is recommended", async () => {
    const { user, subject } = await fixture();
    const temario = await createTemario(testDb.db, { userId: user.id, subjectId: subject.id });
    const a = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "A" });
    const b = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "B" });

    await setRecommendedTopic(testDb.db, temario.id, a.id);
    await setRecommendedTopic(testDb.db, temario.id, b.id);

    const after = await findTemarioBySubject(testDb.db, subject.id);
    expect(after!.topics.find((t) => t.id === a.id)!.recommended).toBe(false);
    expect(after!.topics.find((t) => t.id === b.id)!.recommended).toBe(true);
  });

  it("rejects a milestone that covers beyond the last topic (P0-5)", async () => {
    const { user, subject } = await fixture();
    const temario = await createTemario(testDb.db, { userId: user.id, subjectId: subject.id });
    await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "A" });

    await expect(
      createMilestoneInTemario(testDb.db, {
        temarioId: temario.id,
        kind: "parcial",
        title: "Parcial 1",
        coversUpToOrder: 5,
      }),
    ).rejects.toThrow();
  });

  it("updates and deletes topics/milestones", async () => {
    const { user, subject } = await fixture();
    const temario = await createTemario(testDb.db, { userId: user.id, subjectId: subject.id });
    const topic = await createTopicInTemario(testDb.db, { temarioId: temario.id, title: "Original" });
    const updated = await updateTopicInTemario(testDb.db, { id: topic.id, title: "Renamed" });
    expect(updated.title).toBe("Renamed");

    const milestone = await createMilestoneInTemario(testDb.db, {
      temarioId: temario.id,
      kind: "parcial",
      title: "P",
      coversUpToOrder: 0,
    });
    const updatedMilestone = await updateMilestoneInTemario(testDb.db, { id: milestone.id, title: "Renamed P" });
    expect(updatedMilestone.title).toBe("Renamed P");

    await deleteTopicFromTemario(testDb.db, topic.id);
    await deleteMilestoneFromTemario(testDb.db, milestone.id);
    const after = await findTemarioBySubject(testDb.db, subject.id);
    expect(after!.topics).toHaveLength(0);
    expect(after!.milestones).toHaveLength(0);
  });
});
