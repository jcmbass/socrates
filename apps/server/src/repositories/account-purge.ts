import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  achievements,
  assessments,
  courses,
  exchanges,
  fuenteChunks,
  fuentes,
  fuentesContextMetrics,
  hitos,
  magicLinkTokens,
  masteryHistoryEntries,
  masteryStates,
  materialAssets,
  quotaRejections,
  safetyIncidents,
  sessionOpenings,
  streaks,
  studySessions,
  subjects,
  temas,
  temarios,
  topicItems,
  turnClaims,
  usageQuotas,
  users,
  xpEvents,
} from "../db/schema";
import { markUserDeleted } from "./users";
import { pseudonymizeConsentsForUser } from "./consents";

/**
 * Privacy policy live text: sessions and material are deleted with the
 * account. Consent rows stay as salted pseudonyms.
 */
export async function deleteAccountAndPurge(db: Db, userId: string, consentSalt: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ currentCourseId: null }).where(eq(users.id, userId));

    const sessionIds = (await tx.select({ id: studySessions.id }).from(studySessions).where(eq(studySessions.userId, userId))).map(
      (row) => row.id,
    );
    const subjectIds = (await tx.select({ id: subjects.id }).from(subjects).where(eq(subjects.userId, userId))).map((row) => row.id);
    const temarioIds = (await tx.select({ id: temarios.id }).from(temarios).where(eq(temarios.userId, userId))).map((row) => row.id);
    const fuenteIds = (await tx.select({ id: fuentes.id }).from(fuentes).where(eq(fuentes.userId, userId))).map((row) => row.id);

    if (sessionIds.length > 0) {
      await tx.delete(assessments).where(inArray(assessments.sessionId, sessionIds));
      await tx.delete(turnClaims).where(inArray(turnClaims.sessionId, sessionIds));
      await tx.delete(fuentesContextMetrics).where(inArray(fuentesContextMetrics.sessionId, sessionIds));
      await tx.delete(exchanges).where(inArray(exchanges.sessionId, sessionIds));
    }
    if (fuenteIds.length > 0) {
      await tx.delete(fuenteChunks).where(inArray(fuenteChunks.fuenteId, fuenteIds));
    }
    if (subjectIds.length > 0) {
      await tx.delete(fuentesContextMetrics).where(inArray(fuentesContextMetrics.subjectId, subjectIds));
    }
    if (temarioIds.length > 0) {
      await tx.delete(hitos).where(inArray(hitos.temarioId, temarioIds));
      await tx.delete(temas).where(inArray(temas.temarioId, temarioIds));
    }

    await tx.delete(topicItems).where(eq(topicItems.userId, userId));
    await tx.delete(sessionOpenings).where(eq(sessionOpenings.userId, userId));
    await tx.delete(xpEvents).where(eq(xpEvents.userId, userId));
    await tx.delete(masteryStates).where(eq(masteryStates.userId, userId));
    await tx.delete(masteryHistoryEntries).where(eq(masteryHistoryEntries.userId, userId));
    await tx.delete(safetyIncidents).where(eq(safetyIncidents.userId, userId));
    await tx.delete(quotaRejections).where(eq(quotaRejections.userId, userId));
    await tx.delete(usageQuotas).where(eq(usageQuotas.userId, userId));
    await tx.delete(achievements).where(eq(achievements.userId, userId));
    await tx.delete(streaks).where(eq(streaks.userId, userId));
    await tx.delete(materialAssets).where(eq(materialAssets.userId, userId));
    await tx.delete(fuentes).where(eq(fuentes.userId, userId));
    await tx.delete(studySessions).where(eq(studySessions.userId, userId));
    await tx.delete(temarios).where(eq(temarios.userId, userId));
    await tx.delete(subjects).where(eq(subjects.userId, userId));
    await tx.delete(courses).where(eq(courses.userId, userId));
    await tx.delete(magicLinkTokens).where(eq(magicLinkTokens.userId, userId));

    await markUserDeleted(tx, userId);
    await pseudonymizeConsentsForUser(tx, userId, consentSalt);
  });
}
