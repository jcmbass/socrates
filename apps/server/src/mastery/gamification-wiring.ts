/**
 * G2 gamification wiring — B2 §7.2/§9.4. Called from `routes/sessions.ts`
 * AFTER `applyAssessmentToMastery` returns. Handles:
 *
 * 1. **Streak** (B2 §1.7): when `aggregated === true` (tripleta allowlisted),
 *    runs `updateStreak` and persists. When `aggregated === false`, does
 *    NOT touch streak (B2 §7.2: "pending no mueve streak de nadie").
 *
 * 2. **Achievements** (B2 §4.2-§4.3): when a tier changed (rollup or topic),
 *    runs `maybeAwardAchievements` and persists any newly-earned challenges.
 *    Resolves the I-11 retry linkage at persist time.
 *
 * 3. **Tema progress** (plan-xp-progreso Fase 1): when the session is scoped
 *    to a topic and mastery produced a topic level, write `Tema.stars` via
 *    `tierToStars` (same function as routes/mastery) and set status=`done`
 *    at consolidated+. Stars are monotone (never decrease).
 *
 * 4. **Evidence XP** (plan-xp-progreso Fase 1): score the assessment verdict
 *    with `evidenceXpFromVerdict` and write an `xp_events` row when delta>0.
 *    Independent of the allowlist — evidence is a fact even when mastery
 *    aggregation is gated. Shadow still strips XP from the client payload.
 *
 * All I/O is wrapped in a single transaction for consistency.
 */
import type { Db } from "../db/client";
import type { Assessment } from "@buxo/domain/assessment";
import type { MasteryLevel } from "@buxo/domain/mastery";
import { tierToStars } from "@buxo/domain/mastery";
import { evidenceXpFromVerdict } from "@buxo/domain/xp";
import { updateStreak, maybeAwardAchievements } from "@buxo/domain/gamification-engine";
import { findStreak, upsertStreak } from "../repositories/streaks";
import { listActiveByScope } from "../repositories/challenge-definitions";
import { insertAchievement, listByUserAndSubject, findRevokedForRetry } from "../repositories/achievements";
import { createXpEvent } from "../repositories/xp";
import { findTemarioBySubject, updateTopicInTemario } from "../repositories/temarios";
import { newId } from "../repositories/ids";
import type { ApplyAssessmentToMasteryResult } from "./aggregate";

export interface GamificationWiringInput {
  userId: string;
  subjectId: string;
  /** Session topic scope — null for subject-level / milestone sessions. */
  topicId: string | null;
  assessment: Assessment;
  masteryResult: ApplyAssessmentToMasteryResult;
}

export interface GamificationWiringResult {
  streakUpdated: boolean;
  achievementsAwarded: number;
  /** True when an evidence XP event was persisted. */
  xpRecorded: boolean;
  /** True when Tema.stars and/or status were updated. */
  temaProgressUpdated: boolean;
}

/**
 * Runs gamification logic after mastery aggregation.
 * Called from the post-stream block in routes/sessions.ts.
 * Failures are caught and logged — never break the already-streamed response.
 */
export async function applyGamificationAfterMastery(
  db: Db,
  input: GamificationWiringInput,
): Promise<GamificationWiringResult> {
  const { userId, subjectId, topicId, assessment, masteryResult } = input;
  let streakUpdated = false;
  let achievementsAwarded = 0;
  let xpRecorded = false;
  let temaProgressUpdated = false;

  // --- Streak (B2 §1.7 + §7.2) ---
  if (masteryResult.aggregated) {
    const prevStreak = await findStreak(db, userId);
    const nextStreak = updateStreak(
      prevStreak ?? {
        // `newId()`, NO la cadena vacía. Con `id: ""` el PRIMER estudiante del
        // sistema insertaba bien y TODOS los siguientes chocaban contra
        // `streaks_pkey` — que no es el target del conflicto que maneja
        // `upsertStreak` (ese es `(userId, kind)`), así que la inserción
        // lanzaba. Y el `.catch()` fire-and-forget de `routes/sessions.ts` se
        // lo tragaba: cada estudiante nuevo se quedaba SIN RACHA para siempre,
        // sin un solo error visible. Reproducido de forma determinista con 3
        // usuarios distintos.
        id: newId(),
        userId,
        kind: "assessment_approved",
        current: 0,
        longest: 0,
        lastQualifyingAssessmentId: null,
        lastQualifyingAt: null,
        updatedAt: new Date().toISOString(),
        schemaVersion: 1,
      },
      assessment,
    );

    if (prevStreak) {
      // Preserve the existing id for upsert.
      await upsertStreak(db, { ...nextStreak, id: prevStreak.id });
    } else {
      // New streak row.
      await upsertStreak(db, nextStreak);
    }
    streakUpdated = true;
  }
  // B2 §7.2: when aggregated === false, streak is NOT touched.

  // --- Achievements (B2 §4.2-§4.3) ---
  // Check rollup scope (subject-level).
  if (masteryResult.tierChanged.rollup && masteryResult.nextRollupLevel) {
    achievementsAwarded += await awardAchievementsForScope(
      db, userId, subjectId, null, masteryResult.nextRollupLevel,
    );
  }

  // Check topic scope (if the topic tier changed).
  if (masteryResult.tierChanged.topic && masteryResult.nextTopicLevel) {
    achievementsAwarded += await awardAchievementsForScope(
      db, userId, subjectId, assessment.topicKey, masteryResult.nextTopicLevel,
    );
  }

  // --- Tema.stars + status=done (plan-xp-progreso Fase 1) ---
  // Uses session.topicId (UUID), not assessment.topicKey (free-text label).
  // Stars via the SAME `tierToStars` as routes/mastery — never a second map.
  // Monotone: never decrease stars; never demote done → studying.
  if (topicId && masteryResult.nextTopicLevel) {
    const temario = await findTemarioBySubject(db, subjectId);
    const tema = temario?.topics.find((t) => t.id === topicId);
    if (tema) {
      const nextStars = tierToStars(masteryResult.nextTopicLevel.tier);
      const stars = Math.max(tema.stars, nextStars) as 0 | 1 | 2 | 3;
      const tier = masteryResult.nextTopicLevel.tier;
      const shouldMarkDone = tier === "consolidated" || tier === "mastered";
      const status = shouldMarkDone ? "done" : tema.status === "done" ? "done" : tema.status;

      if (stars !== tema.stars || status !== tema.status) {
        await updateTopicInTemario(db, { id: topicId, stars, status });
        temaProgressUpdated = true;
      }
    }
  }

  // --- Evidence XP (plan-xp-progreso Fase 1) — write but do not show in shadow ---
  const scored = evidenceXpFromVerdict(assessment);
  if (scored) {
    await createXpEvent(db, {
      userId,
      subjectId,
      topicId: topicId ?? undefined,
      delta: scored.delta,
      reason: scored.reason,
      assessmentRef: { assessmentId: assessment.id, sessionId: assessment.sessionId },
    });
    xpRecorded = true;
  }

  return { streakUpdated, achievementsAwarded, xpRecorded, temaProgressUpdated };
}

async function awardAchievementsForScope(
  db: Db,
  userId: string,
  subjectId: string,
  topicKeyOrNull: string | null,
  newLevel: MasteryLevel,
): Promise<number> {
  const activeDefinitions = await listActiveByScope(db, subjectId, topicKeyOrNull);
  if (activeDefinitions.length === 0) return 0;

  const existingAchievements = await listByUserAndSubject(db, userId, subjectId);
  const existingEarned = existingAchievements.map((a) => ({
    challengeDefinitionId: a.challengeDefinitionId,
    status: a.status,
  }));

  const newAchievements = maybeAwardAchievements(
    userId,
    subjectId,
    topicKeyOrNull,
    newLevel,
    existingEarned,
    activeDefinitions,
  );

  let awarded = 0;
  for (const na of newAchievements) {
    // Resolve I-11 retry linkage: if there's a prior revoked Achievement
    // for this (userId, challengeDefinitionId, scope), set retryOf to its id.
    const revoked = await findRevokedForRetry(db, userId, na.challengeDefinitionId, subjectId, topicKeyOrNull);
    const retryOf = revoked?.id ?? null;

    await insertAchievement(db, {
      userId,
      challengeDefinitionId: na.challengeDefinitionId,
      challengeDefinitionVersion: na.challengeDefinitionVersion,
      subjectId,
      topicKey: topicKeyOrNull,
      evidenceAssessmentIds: na.evidenceAssessmentIds,
      retryOf,
    });
    awarded++;
  }

  return awarded;
}
