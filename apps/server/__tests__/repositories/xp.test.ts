/**
 * Repository-level tests for `repositories/xp.ts` — Fase P1.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import { createXpEvent, listXpEventsByUser, getXpTotal, computeXpTotals, applyXpDemotionPolicy } from "../../src/repositories/xp";

describe("repositories/xp.ts — P1", () => {
  let testDb: TestDb;
  let user: import("@buxo/domain/user").User;
  let subject: import("@buxo/domain/subject").Subject;

  beforeEach(async () => {
    testDb = await createTestDb();
    user = await createUser(testDb.db, { email: "xp-repo@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
    const course = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    subject = await createSubject(testDb.db, { userId: user.id, courseId: course.id, name: "Química" });
  });

  afterEach(async () => {
    await testDb?.close();
  });

  it("creates XP events and aggregates totals via xp_total", async () => {
    await createXpEvent(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      delta: 100,
      reason: "tier_promoted",
      assessmentRef: { assessmentId: "a1", sessionId: "s1" },
    });
    await createXpEvent(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      delta: 100,
      reason: "tier_promoted",
      assessmentRef: { assessmentId: "a2", sessionId: "s1" },
    });

    expect(await getXpTotal(testDb.db, user.id)).toBe(200);
    expect(await getXpTotal(testDb.db, user.id, subject.id)).toBe(200);
  });

  it("lists XP events scoped by user and optional subject/topic", async () => {
    await createXpEvent(testDb.db, { userId: user.id, subjectId: subject.id, delta: 10, reason: "tier_promoted", assessmentRef: { assessmentId: "a", sessionId: "s" } });
    await createXpEvent(testDb.db, { userId: user.id, subjectId: subject.id, topicId: "t1", delta: 20, reason: "tier_promoted", assessmentRef: { assessmentId: "b", sessionId: "s" } });

    expect(await listXpEventsByUser(testDb.db, user.id)).toHaveLength(2);
    expect(await listXpEventsByUser(testDb.db, user.id, { subjectId: subject.id })).toHaveLength(2);
    expect(await listXpEventsByUser(testDb.db, user.id, { topicId: "t1" })).toHaveLength(1);
  });

  it("applies the three XP demotion policies correctly", () => {
    expect(applyXpDemotionPolicy(-50, 80, "subtract")).toBe(-50);
    expect(applyXpDemotionPolicy(-100, 80, "floor")).toBe(-80);
    expect(applyXpDemotionPolicy(-100, 80, "grow_only")).toBe(0);

    const events = [
      { delta: 100 } as import("@buxo/domain/xp").XpEvent,
      { delta: -40 } as import("@buxo/domain/xp").XpEvent,
    ];
    expect(computeXpTotals(events, "subtract")).toMatchObject({ raw: 60, visible: 60 });
    expect(computeXpTotals(events, "floor")).toMatchObject({ raw: 60, visible: 60 });
    expect(computeXpTotals(events, "grow_only")).toMatchObject({ raw: 60, visible: 100 });
  });
});
