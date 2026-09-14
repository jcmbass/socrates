import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { exchanges } from "../db/schema";
import type { Exchange } from "@buxo/domain/exchange";
import type { Band } from "@buxo/core/prompts";
import { newId } from "./ids";

function rowToExchange(row: typeof exchanges.$inferSelect): Exchange {
  return {
    id: row.id,
    sessionId: row.sessionId,
    index: row.index_,
    timestamp: row.timestamp,
    studentMessage: row.studentMessage,
    tutorReply: row.tutorReply,
    band: row.band,
    tutorPromptVersion: row.tutorPromptVersion,
    tutorModelId: row.tutorModelId,
    tutorProviderId: row.tutorProviderId,
    hintOffered: row.hintOffered,
    studentCorrect: row.studentCorrect,
    judgePromptVersion: row.judgePromptVersion,
    judgeModelId: row.judgeModelId,
    judgeProviderId: row.judgeProviderId,
    schemaVersion: row.schemaVersion,
  };
}

export interface CreateExchangeInput {
  sessionId: string;
  index: number;
  studentMessage: string;
  tutorReply: string;
  band: Band;
  tutorPromptVersion: string;
  tutorModelId: string;
  tutorProviderId: string;
}

/** I-12: only ever called once the tutor's full reply is in hand (never mid-stream). */
export async function createExchange(db: Db, input: CreateExchangeInput): Promise<Exchange> {
  const [row] = await db
    .insert(exchanges)
    .values({
      id: newId(),
      sessionId: input.sessionId,
      index_: input.index,
      timestamp: new Date().toISOString(),
      studentMessage: input.studentMessage,
      tutorReply: input.tutorReply,
      band: input.band,
      tutorPromptVersion: input.tutorPromptVersion,
      tutorModelId: input.tutorModelId,
      tutorProviderId: input.tutorProviderId,
      hintOffered: null,
      studentCorrect: null,
      judgePromptVersion: null,
      judgeModelId: null,
      judgeProviderId: null,
      schemaVersion: 1,
    })
    .returning();
  return rowToExchange(row);
}

export async function listExchangesBySession(db: Db, sessionId: string): Promise<Exchange[]> {
  const rows = await db.select().from(exchanges).where(eq(exchanges.sessionId, sessionId)).orderBy(asc(exchanges.index_));
  return rows.map(rowToExchange);
}

export interface JudgeVerdictInput {
  hintOffered: boolean;
  studentCorrect: boolean;
  judgePromptVersion: string;
  judgeModelId: string;
  judgeProviderId: string;
}

export async function recordJudgeVerdict(db: Db, exchangeId: string, verdict: JudgeVerdictInput): Promise<void> {
  await db
    .update(exchanges)
    .set({
      hintOffered: verdict.hintOffered,
      studentCorrect: verdict.studentCorrect,
      judgePromptVersion: verdict.judgePromptVersion,
      judgeModelId: verdict.judgeModelId,
      judgeProviderId: verdict.judgeProviderId,
    })
    .where(eq(exchanges.id, exchangeId));
}
