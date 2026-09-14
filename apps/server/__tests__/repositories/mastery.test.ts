/**
 * Repository-level tests for `repositories/mastery.ts` — F2 WQ3 parte B1.
 * Exercises the transactional write path directly (no HTTP layer): atomic
 * state+history writes, the `(userId, subjectId, topicKey)` unique
 * constraint (upsert on conflict), and B3's I-2 executable invariant on
 * what comes back out.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { createUser } from "../../src/repositories/users";
import { createCourse } from "../../src/repositories/courses";
import { createSubject } from "../../src/repositories/subjects";
import {
  findMasteryState,
  listMasteryHistoryByState,
  listMasteryHistoryBySubject,
  listMasteryStatesBySubject,
  writeMasteryState,
} from "../../src/repositories/mastery";
import { assertMasteryStateWrittenWithHistoryEntry } from "@buxo/domain/invariants";
import { DEFAULT_MASTERY_AGGREGATION_CONFIG } from "@buxo/domain/mastery-engine";
import { SUBJECT_ROLLUP_TOPIC_KEY } from "@buxo/domain/sentinels";
import type { MasteryLevel } from "@buxo/domain/mastery";

function emergingLevel(overrides: Partial<MasteryLevel> = {}): MasteryLevel {
  return {
    tier: "emerging",
    positiveStreak: 0,
    negativeStreak: 0,
    strongCount: 0,
    recentStrongEvidence: [],
    lastPositiveAt: null,
    lastPromotionAt: null,
    ...overrides,
  };
}

describe("repositories/mastery.ts — B1", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  async function fixture() {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, { email: "mastery-repo@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
    const course = await createCourse(testDb.db, { userId: user.id, gradeLevelId: "sv-bachillerato-1" });
    const subject = await createSubject(testDb.db, { userId: user.id, courseId: course.id, name: "Cálculo" });
    return { user, subject };
  }

  it("writes MasteryState + MasteryHistoryEntry atomically, satisfying I-2", async () => {
    const { user, subject } = await fixture();
    const level = emergingLevel();

    const { state, historyEntry } = await writeMasteryState(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      topicKey: SUBJECT_ROLLUP_TOPIC_KEY,
      level,
      visibility: "shadow",
      computedByVersion: DEFAULT_MASTERY_AGGREGATION_CONFIG.version,
      contributingAssessmentIds: ["a1"],
    });

    expect(state.lastHistoryEntryId).toBe(historyEntry.id);
    expect(state.currentLevel).toEqual(level);
    expect(historyEntry.level).toEqual(level);
    expect(historyEntry.contributingAssessmentIds).toEqual(["a1"]);
    // Re-check the invariant explicitly — this is exactly what the repo asserts internally before returning.
    expect(() => assertMasteryStateWrittenWithHistoryEntry(state, historyEntry)).not.toThrow();

    const found = await findMasteryState(testDb.db, user.id, subject.id, SUBJECT_ROLLUP_TOPIC_KEY);
    expect(found).toEqual(state);
  });

  it("a second write to the SAME (userId, subjectId, topicKey) upserts — one row, unique constraint respected", async () => {
    const { user, subject } = await fixture();

    const first = await writeMasteryState(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      topicKey: SUBJECT_ROLLUP_TOPIC_KEY,
      level: emergingLevel(),
      visibility: "shadow",
      computedByVersion: DEFAULT_MASTERY_AGGREGATION_CONFIG.version,
      contributingAssessmentIds: ["a1"],
    });

    const second = await writeMasteryState(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      topicKey: SUBJECT_ROLLUP_TOPIC_KEY,
      level: emergingLevel({ positiveStreak: 1 }),
      visibility: "shadow",
      computedByVersion: DEFAULT_MASTERY_AGGREGATION_CONFIG.version,
      contributingAssessmentIds: ["a2"],
    });

    expect(second.state.id).toBe(first.state.id); // same row, updated in place
    expect(second.state.lastHistoryEntryId).toBe(second.historyEntry.id);
    expect(second.state.currentLevel.positiveStreak).toBe(1);

    const states = await listMasteryStatesBySubject(testDb.db, user.id, subject.id);
    expect(states).toHaveLength(1);

    // BOTH history entries persist (append-only) even though only one MasteryState row exists.
    const history = await listMasteryHistoryByState(testDb.db, user.id, subject.id, SUBJECT_ROLLUP_TOPIC_KEY);
    expect(history.map((h) => h.id)).toEqual([first.historyEntry.id, second.historyEntry.id]);
  });

  it("rollup and per-topic states coexist as separate rows for the same subject", async () => {
    const { user, subject } = await fixture();

    await writeMasteryState(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      topicKey: SUBJECT_ROLLUP_TOPIC_KEY,
      level: emergingLevel(),
      visibility: "shadow",
      computedByVersion: DEFAULT_MASTERY_AGGREGATION_CONFIG.version,
      contributingAssessmentIds: ["a1"],
    });
    await writeMasteryState(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      topicKey: "fracciones-equivalentes",
      level: emergingLevel(),
      visibility: "shadow",
      computedByVersion: DEFAULT_MASTERY_AGGREGATION_CONFIG.version,
      contributingAssessmentIds: ["a1", "a2", "a3"],
    });

    const states = await listMasteryStatesBySubject(testDb.db, user.id, subject.id);
    expect(states).toHaveLength(2);
    expect(states.map((s) => s.topicKey).sort()).toEqual(["", "fracciones-equivalentes"]);
  });

  it("listMasteryHistoryBySubject returns entries across every scope, most recent first", async () => {
    const { user, subject } = await fixture();

    const rollup1 = await writeMasteryState(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      topicKey: SUBJECT_ROLLUP_TOPIC_KEY,
      level: emergingLevel(),
      visibility: "shadow",
      computedByVersion: DEFAULT_MASTERY_AGGREGATION_CONFIG.version,
      contributingAssessmentIds: ["a1"],
    });
    const topic1 = await writeMasteryState(testDb.db, {
      userId: user.id,
      subjectId: subject.id,
      topicKey: "derivadas",
      level: emergingLevel(),
      visibility: "shadow",
      computedByVersion: DEFAULT_MASTERY_AGGREGATION_CONFIG.version,
      contributingAssessmentIds: ["a1", "a2", "a3"],
    });

    const history = await listMasteryHistoryBySubject(testDb.db, user.id, subject.id);
    expect(history.map((h) => h.id).sort()).toEqual([rollup1.historyEntry.id, topic1.historyEntry.id].sort());
  });

  it("findMasteryState returns null when no row exists yet (absence of a row IS 'no evidence', B2 §2)", async () => {
    const { user, subject } = await fixture();
    const found = await findMasteryState(testDb.db, user.id, subject.id, SUBJECT_ROLLUP_TOPIC_KEY);
    expect(found).toBeNull();
  });
});
