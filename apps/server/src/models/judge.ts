/**
 * Judge call — C-backend §1.1/§1.3, ported from
 * `apps/harness/app/api/judge/route.ts` onto `StructuredAdapter`. Sampled
 * (D3 §7): the caller (routes/sessions.ts) decides whether to invoke this
 * at all for a given exchange, per `JUDGE_SAMPLE_RATE`. Degrade-to-null
 * contract preserved exactly, same as the assessor. Cost comes off
 * `StructuredCallResult.costUsd` directly — see models/assess.ts's module
 * doc for why the per-call `InMemoryTelemetrySink` workaround is gone.
 */
import { z } from "zod";
import { getJudgeSystemPrompt } from "@buxo/core/prompts";
import { NoopTelemetrySink } from "@buxo/models/telemetry";
import type { ModelRef } from "@buxo/models/task";
import type { ModelDeps } from "./adapters";

export const judgeSchema = z.object({
  hint_offered: z.boolean(),
  student_correct: z.boolean(),
});

export interface RunJudgeInput {
  studentMessage: string;
  tutorReply: string;
  subject?: string;
}

export interface JudgeOutcome {
  hintOffered: boolean | null;
  studentCorrect: boolean | null;
  servedBy: ModelRef | null;
  promptVersion: string | null;
  costUsd: number | null;
}

export async function runJudge(
  modelDeps: Pick<ModelDeps, "createStructuredAdapter">,
  input: RunJudgeInput,
): Promise<JudgeOutcome> {
  const structuredAdapter = modelDeps.createStructuredAdapter(new NoopTelemetrySink());

  const result = await structuredAdapter.generateStructured({
    task: "judge",
    system: getJudgeSystemPrompt(input.subject),
    prompt: `Student answer:\n${input.studentMessage}\n\nTutor reply:\n${input.tutorReply}`,
    schema: judgeSchema,
  });

  if (!result.ok) {
    return { hintOffered: null, studentCorrect: null, servedBy: null, promptVersion: null, costUsd: result.costUsd };
  }
  return {
    hintOffered: result.object.hint_offered,
    studentCorrect: result.object.student_correct,
    servedBy: result.servedBy,
    promptVersion: result.promptVersion,
    costUsd: result.costUsd,
  };
}
