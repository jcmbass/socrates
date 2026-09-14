/**
 * Regresión: la racha se rompía para TODO estudiante salvo el primero.
 *
 * `gamification-wiring.ts` sembraba la racha nueva con `id: ""` literal. El
 * primer usuario del sistema insertaba bien; a partir del segundo, la
 * inserción chocaba contra la clave primaria `streaks_pkey` — que NO es el
 * target de conflicto que maneja `upsertStreak` (ese es `(userId, kind)`) —
 * así que lanzaba. Y el `.catch()` fire-and-forget de `routes/sessions.ts` se
 * lo tragaba: cada estudiante nuevo se quedaba sin racha para siempre, **sin
 * un solo error visible**, viendo "Todavía no hay racha" indefinidamente.
 *
 * Cazado empíricamente ejercitando el recorrido del estudiante contra el
 * harness local (2026-07-28), reproducido de forma determinista con 3
 * usuarios distintos.
 *
 * Este test falla con `id: ""` y pasa con `newId()`. Es lo que impide que
 * vuelva: cualquier valor de id que no sea único por fila lo rompe.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { createUser } from "../../src/repositories/users";
import { findStreak, upsertStreak } from "../../src/repositories/streaks";
import { newId } from "../../src/repositories/ids";
import { applyGamificationAfterMastery } from "../../src/mastery/gamification-wiring";
import type { Assessment } from "@buxo/domain/assessment";
import type { ApplyAssessmentToMasteryResult } from "../../src/mastery/aggregate";

let testDb: TestDb;

afterEach(async () => {
  await testDb?.close();
});

describe("streaks — una racha por estudiante, no solo para el primero", () => {
  it("dos estudiantes distintos obtienen cada uno su fila de racha", async () => {
    testDb = await createTestDb();

    const userA = await createUser(testDb.db, {
      email: "racha-a@example.com",
      displayName: "Ana",
      ageConfirmedAt: new Date().toISOString(),
    });
    const userB = await createUser(testDb.db, {
      email: "racha-b@example.com",
      displayName: "Beto",
      ageConfirmedAt: new Date().toISOString(),
    });

    // Reproduce lo que hace `applyGamificationAfterMastery` al sembrar una
    // racha nueva: un id fresco por fila. Con `id: ""` en ambas, la segunda
    // inserción rompe.
    for (const userId of [userA.id, userB.id]) {
      await upsertStreak(testDb.db, {
        id: newId(),
        userId,
        kind: "assessment_approved",
        current: 1,
        longest: 1,
        lastQualifyingAssessmentId: null,
        lastQualifyingAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        schemaVersion: 1,
      });
    }

    const streakA = await findStreak(testDb.db, userA.id);
    const streakB = await findStreak(testDb.db, userB.id);

    expect(streakA).not.toBeNull();
    expect(streakB).not.toBeNull();
    expect(streakA!.current).toBe(1);
    expect(streakB!.current).toBe(1);
    expect(streakA!.id).not.toBe(streakB!.id);
  });
  /**
   * El test de arriba fija la invariante a nivel de base. ESTE ejercita el
   * CAMINO REAL donde vivía el bug: `applyGamificationAfterMastery` sembrando
   * la racha. Con `id: ""` la segunda llamada lanza; con `newId()` pasa.
   */
  it("applyGamificationAfterMastery siembra racha para DOS usuarios distintos", async () => {
    testDb = await createTestDb();

    const users = [];
    for (const [email, name] of [["wiring-a@example.com", "Ana"], ["wiring-b@example.com", "Beto"]]) {
      users.push(await createUser(testDb.db, { email, displayName: name, ageConfirmedAt: new Date().toISOString() }));
    }

    // Verdict that does NOT award evidence XP — this test only cares about
    // streak seeding across users. A scoring verdict would also try to write
    // xp_events with a fake subjectId (FK) and muddy the regression signal.
    const assessment = {
      id: newId(),
      sessionId: newId(),
      demonstratedUnderstanding: "weak",
      explainedInOwnWords: false,
      guessedOrPatternMatched: false,
    } as unknown as Assessment;

    const masteryResult = {
      aggregated: true,
      materializedTopic: false,
      nextRollupLevel: null,
      nextTopicLevel: null,
      tierChanged: { rollup: false, topic: false },
    } as unknown as ApplyAssessmentToMasteryResult;

    for (const user of users) {
      // Si esto lanza para el segundo usuario, el bug volvió.
      await applyGamificationAfterMastery(testDb.db, {
        userId: user.id,
        subjectId: newId(),
        topicId: null,
        assessment,
        masteryResult,
      });
    }

    for (const user of users) {
      expect(await findStreak(testDb.db, user.id)).not.toBeNull();
    }
  });
});
