/**
 * `BUXO_FAKE_MODELS` dev mode — a fully-fake `ModelAdapters` (F1/WP6
 * Part 1). Never imports `"ai"`, never calls `createTutorAdapter`/
 * `createStructuredAdapter` from `@buxo/models/execution/*` — those wrap
 * `streamText`/`generateObject`, which would make a REAL network call the
 * moment they're invoked, fake `ProviderResolver` or not (the resolver only
 * fakes the `LanguageModel` object handed to those functions; it does
 * nothing to stop the functions themselves from trying to reach a
 * provider). A test can get away with just faking the resolver because it
 * ALSO mocks `streamText`/`generateObject` at the module level
 * (`vi.mock("ai", ...)`, see __tests__/support/fake-provider.ts's module
 * doc) — a running server can't do that, so this module reimplements the
 * `TutorAdapter`/`StructuredAdapter` surface directly with canned data.
 *
 * `servedBy` on every fake call/verdict is the REAL first candidate of that
 * task's resolved chain (`resolveChain(config, task)[0]`) — never a
 * synthetic `{providerId:"fake", ...}` pair. This is deliberate: sessions.ts
 * and this module's own callers (models/assess.ts, models/judge.ts) feed
 * `servedBy` into `@buxo/models/registry`'s `requireCapabilities` (fail-loud
 * on an unregistered pair) to compute `costUsd` for quota accounting — using
 * a real registered pair keeps that whole path exercised in fake mode
 * without touching `packages/*`. Only the CONTENT is canned; the
 * provenance label borrows a real, already-gated registry row.
 */
import { resolveChain, type ResolvedModelsConfig } from "@buxo/models/config";
import type { Environment, ModelRef } from "@buxo/models/task";
import type { TelemetrySink } from "@buxo/models/telemetry";
import { estimateCostUsd } from "@buxo/models/capabilities";
import { requireCapabilities } from "@buxo/models/registry";
import type { TutorAdapter, TutorCallParams, TutorStreamReply, TutorStreamTextResult } from "@buxo/models/execution/tutor";
import type { MilestoneAdapter, MilestoneCallParams, MilestoneStreamReply } from "@buxo/models/execution/milestone";
import { MILESTONE_PROMPT_VERSION } from "@buxo/core/milestone-prompt";
import type { StructuredAdapter, StructuredCallParams, StructuredCallResult } from "@buxo/models/execution/structured";
import type { IngestAdapter, IngestCallParams, IngestTranscription } from "@buxo/models/execution/ingest";
import {
  type TemarioBuilderAdapter,
  type TemarioBuilderCallParams,
  type TemarioBuilderResult,
} from "@buxo/models/execution/temario-builder";
import { PROMPT_VERSION, type Band } from "@buxo/core/prompts";
import type { ModelAdapters } from "./adapters";
import { deterministicIndex, fakeProviderResolver } from "./fakes";

// ---------------------------------------------------------------------------
// Tutor — multi-chunk streamed, Socratic-style, varied, with $...$/$$...$$.
// ---------------------------------------------------------------------------

/**
 * Varied canned Socratic replies (never gives the answer, always asks a
 * question back) — a mix of inline (`$...$`) and block (`$$...$$`) math, and
 * a few with no math at all, so apps/mobile's KaTeX-in-WebView render path
 * (WP2) gets exercised by BOTH cases during F1/WP6 device verification.
 */
export const FAKE_TUTOR_REPLIES: readonly string[] = [
  "¿Qué pasa si multiplicás ambos lados de la ecuación por $2$? Fijate qué término se cancela y contame qué te queda.",
  "Pensemos juntos: si la derivada de $x^2$ es $2x$, ¿qué esperarías para $x^3$? Probá antes de mirar la regla.",
  "Antes de seguir, ¿podés explicar con tus propias palabras por qué elegiste ese paso?",
  "Mirá esta igualdad:\n\n$$\\int_0^1 x\\,dx = \\frac{1}{2}$$\n\n¿Qué relación ves entre esa área y el resultado?",
  "¿Qué observás sobre la pendiente en ese punto? Probá calcular $f'(1)$ y contame qué te da.",
  "Si sabés que\n\n$$a^2 + b^2 = c^2$$\n\nen un triángulo rectángulo, ¿qué te dice eso sobre los catetos que ya tenés?",
  "No te apures a la respuesta. ¿Qué regla usarías primero, la de la cadena o la del producto? ¿Por qué esa y no la otra?",
  "Contame: ¿qué pasaría si el denominador $x - 3$ fuera cero? ¿Por qué importa eso en este ejercicio?",
  "Buen intento. Antes de corregir nada: ¿cómo verificarías vos mismo si ese resultado tiene sentido?",
  "¿Qué patrón notás entre $\\frac{1}{2}$, $\\frac{1}{4}$ y $\\frac{1}{8}$? Intentá ponerlo en palabras antes de calcular el siguiente término.",
];

function lastMessageText(params: TutorCallParams): string {
  const last = params.messages.at(-1);
  if (!last) return "";
  return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
}

/** Deterministic template pick — same (band, last message) always serves the same reply. */
export function pickFakeTutorReply(band: Band, seed: string): string {
  const index = deterministicIndex(`${band}:${seed}`, FAKE_TUTOR_REPLIES.length);
  return FAKE_TUTOR_REPLIES[index];
}

/**
 * Splits `text` into word-grouped chunks that reconstruct EXACTLY to `text`
 * when concatenated in order (each chunk after the first carries the
 * separating space) — used to emulate token-by-token streaming without
 * corrupting the reply.
 */
export function chunkFakeReply(text: string, wordsPerChunk = 3): string[] {
  const words = text.split(" ");
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const slice = words.slice(i, i + wordsPerChunk).join(" ");
    chunks.push(i === 0 ? slice : ` ${slice}`);
  }
  return chunks;
}

/** A real, progressively-flushed streaming Response body — not a single blob — so apps/mobile genuinely observes multiple chunks over `expo/fetch` (DF-5.2). */
function createFakeStreamBody(text: string, chunkDelayMs = 30): ReadableStream<Uint8Array> {
  const chunks = chunkFakeReply(text);
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const pushNext = () => {
        if (i >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
        setTimeout(pushNext, chunkDelayMs);
      };
      pushNext();
    },
  });
}

function estimateFakeTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function fakeUsage(promptText: string, replyText: string) {
  return {
    inputTokens: estimateFakeTokens(promptText),
    outputTokens: estimateFakeTokens(replyText),
    inputTokenDetails: { noCacheTokens: estimateFakeTokens(promptText), cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

function createFakeTutorAdapter(config: ResolvedModelsConfig): TutorAdapter {
  return {
    async streamReply(params: TutorCallParams): Promise<TutorStreamReply> {
      const servedBy: ModelRef = resolveChain(config, "tutor")[0];
      const seed = lastMessageText(params);
      const fullText = pickFakeTutorReply(params.band, seed);
      const promptText = params.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

      // `TutorStreamTextResult` is the AI SDK's full `StreamTextResult` type
      // (see execution/tutor.ts's module doc) — sessions.ts only ever touches
      // `.toTextStreamResponse()` / `.text` / `.usage`, so the fake only
      // needs to satisfy that structural subset; the cast mirrors the same
      // narrow, deliberate `fakeModel()` cast this package already uses
      // (fakes.ts).
      const result = {
        text: Promise.resolve(fullText),
        usage: Promise.resolve(fakeUsage(promptText, fullText)),
        toTextStreamResponse: () =>
          new Response(createFakeStreamBody(fullText), {
            headers: { "content-type": "text/plain; charset=utf-8", "x-buxo-fake-models": "1" },
          }),
      } as unknown as TutorStreamTextResult;

      return { result, servedBy, promptVersion: PROMPT_VERSION };
    },
  };
}

// ---------------------------------------------------------------------------
// Milestone (P5, DF-P05) — canned review-round replies. Mirrors
// createFakeTutorAdapter's shape/streaming behavior exactly (same
// `TutorStreamTextResult`-compatible surface, same fake chunked body) —
// this is deliberately NOT sharing code with the tutor fake beyond that
// structural pattern, matching the real adapters' R2 separation.
// ---------------------------------------------------------------------------

const FAKE_MILESTONE_REPLIES: readonly string[] = [
  "[fake repaso] Antes de arrancar: este repaso no bloquea nada, es solo para que veas dónde estás parado. Empecemos por el tema más antiguo del cúmulo — ¿qué recordás de eso?",
  "[fake repaso] Buen punto. Ahora pensemos en uno de los temas más recientes — ¿cómo lo conectarías con lo que ya repasamos?",
  "[fake repaso] Interesante. ¿Te animás a explicar ese último paso con tus propias palabras, apoyándote solo en lo que estudiaste?",
];

function createFakeMilestoneAdapter(config: ResolvedModelsConfig): MilestoneAdapter {
  return {
    async streamReply(params: MilestoneCallParams): Promise<MilestoneStreamReply> {
      const servedBy: ModelRef = resolveChain(config, "tutor")[0];
      const seed = `${params.milestoneTitle}:${lastMessageText(params as unknown as TutorCallParams)}`;
      const fullText = FAKE_MILESTONE_REPLIES[deterministicIndex(seed, FAKE_MILESTONE_REPLIES.length)];
      const promptText = params.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

      const result = {
        text: Promise.resolve(fullText),
        usage: Promise.resolve(fakeUsage(promptText, fullText)),
        toTextStreamResponse: () =>
          new Response(createFakeStreamBody(fullText), {
            headers: { "content-type": "text/plain; charset=utf-8", "x-buxo-fake-models": "1" },
          }),
      } as unknown as TutorStreamTextResult;

      return { result: result as unknown as MilestoneStreamReply["result"], servedBy, promptVersion: MILESTONE_PROMPT_VERSION };
    },
  };
}

// ---------------------------------------------------------------------------
// Structured (assessor/judge) — deterministic canned verdicts.
// ---------------------------------------------------------------------------

/**
 * Mirrors models/assess.ts's `assessorSchema` field-for-field (kept in sync
 * by hand — both live in apps/server). `topicKey` (F2 WQ3 parte B2, B2 §3):
 * fixed, rotating labels — deliberately coupled to the SAME `deterministicIndex`
 * pick as the rest of the verdict (see `fakeAssessorObject` below), so a
 * `BUXO_FAKE_MODELS`/device-verification session that keeps landing on the
 * same canned verdict (e.g. repeating a similar student message) also keeps
 * landing on the same topicKey — the ≥3-recurrence path to per-topic
 * materialization (B2 §3.2) is exercisable by just repeating a turn a few
 * times, without needing a dedicated fourth rotation axis.
 */
const FAKE_ASSESSOR_VERDICTS: readonly {
  demonstratedUnderstanding: "none" | "weak" | "developing" | "solid";
  explainedInOwnWords: boolean;
  guessedOrPatternMatched: boolean;
  recommendedBand: Band;
  rationale: string;
  topicKey: string | null;
}[] = [
  {
    demonstratedUnderstanding: "solid",
    explainedInOwnWords: true,
    guessedOrPatternMatched: false,
    recommendedBand: "minimal",
    rationale: "[fake] El estudiante explicó el razonamiento completo con sus propias palabras, sin apoyarse en pistas adicionales.",
    topicKey: "Fracciones equivalentes",
  },
  {
    demonstratedUnderstanding: "developing",
    explainedInOwnWords: true,
    guessedOrPatternMatched: false,
    recommendedBand: "probing",
    rationale: "[fake] Comprensión parcial: conectó el paso correcto pero todavía se beneficia de preguntas guía.",
    topicKey: "Regla de la cadena",
  },
  {
    demonstratedUnderstanding: "weak",
    explainedInOwnWords: false,
    guessedOrPatternMatched: true,
    recommendedBand: "guiding",
    rationale: "[fake] La respuesta parece un patrón repetido sin justificación propia; conviene volver a guiar paso a paso.",
    topicKey: null,
  },
];

/** Mirrors models/judge.ts's `judgeSchema` field-for-field. */
const FAKE_JUDGE_VERDICTS: readonly { hint_offered: boolean; student_correct: boolean }[] = [
  { hint_offered: true, student_correct: true },
  { hint_offered: true, student_correct: false },
  { hint_offered: false, student_correct: true },
];

function fakeAssessorObject(seed: string) {
  return FAKE_ASSESSOR_VERDICTS[deterministicIndex(seed, FAKE_ASSESSOR_VERDICTS.length)];
}

function fakeJudgeObject(seed: string) {
  return FAKE_JUDGE_VERDICTS[deterministicIndex(seed, FAKE_JUDGE_VERDICTS.length)];
}

function fakeGuidedItemsObject(prompt: string) {
  const title = prompt.match(/^Tema:\s*(.+)$/m)?.[1]?.trim() || "Movimiento rectilíneo";
  const sourcesBlock = prompt.includes("Fuentes autorizadas:")
    ? prompt.slice(prompt.indexOf("Fuentes autorizadas:"))
    : "";
  const sourceLine =
    sourcesBlock
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 8 && !line.startsWith("###") && !line.startsWith("Fuentes")) ?? "";
  const fact = sourceLine || `En ${title}, las magnitudes se interpretan respecto de un sistema de referencia.`;
  return {
    items: [
      {
        type: "expose",
        difficulty: 1,
        prompt: `${title}: ${fact}`.slice(0, 220),
        options: [],
        answer: "",
        explanation: `La idea se ancla en el tema «${title}» y en el hecho anterior, no en un consejo de estudio.`,
      },
      {
        type: "expose",
        difficulty: 1,
        prompt: `Una segunda idea de «${title}» es relacionar cambio, intervalo y signo según el eje elegido.`,
        options: [],
        answer: "",
        explanation: "El signo no mide lentitud: indica el sentido respecto del eje positivo.",
      },
      {
        type: "elige",
        difficulty: 1,
        prompt: `En «${title}», ¿qué magnitud ubica un objeto respecto de un origen?`,
        options: ["Rapidez media", "Intervalo de tiempo", "Posición", "Masa inercial"],
        answer: 2,
        explanation: `La posición es la coordenada relativa al origen; eso es el ancla de «${title}», no la rapidez.`,
      },
      {
        type: "verdadero_falso",
        difficulty: 1,
        prompt: `En «${title}», una velocidad negativa puede indicar sentido opuesto al eje positivo.`,
        options: ["Verdadero", "Falso"],
        answer: "Verdadero",
        explanation: "El signo expresa sentido según el referencial; no significa que el objeto vaya más lento.",
      },
      {
        type: "completa",
        difficulty: 2,
        prompt: `Si en «${title}» la posición cambia 20 m en 4 s, la velocidad media es ____.`,
        options: ["80 m/s", "5 m/s", "0.2 m/s"],
        answer: 1,
        explanation: "Velocidad media = desplazamiento / tiempo = 20/4 = 5 m/s, no el producto ni el inverso.",
      },
      {
        type: "elige",
        difficulty: 2,
        prompt: sourceLine
          ? `Según las fuentes de «${title}», ¿qué relación describe el texto?`
          : `Un móvil de «${title}» mantiene 3 m/s durante 4 s. ¿Qué desplazamiento realiza?`,
        options: sourceLine
          ? ["Masa por aceleración", fact.slice(0, 48) || "Cambio de posición / tiempo", "Solo el valor puntual", "Una constante sin unidades"]
          : ["7 m", "1.3 m", "0.75 m", "12 m"],
        answer: sourceLine ? 1 : 3,
        explanation: sourceLine
          ? `La fuente afirma: ${fact} Eso justifica la opción, no un eslogan del tema.`
          : "Con velocidad constante, desplazamiento = velocidad × tiempo = 3 × 4 = 12 m.",
      },
      {
        type: "verdadero_falso",
        difficulty: 2,
        prompt: `Si la posición no cambia durante un intervalo de «${title}», la velocidad media es cero.`,
        options: ["Verdadero", "Falso"],
        answer: "Verdadero",
        explanation: "Sin cambio de posición el cociente desplazamiento/tiempo es cero en ese intervalo.",
      },
      {
        type: "completa",
        difficulty: 3,
        prompt: `Un móvil de «${title}» pasa de x=10 m a x=4 m; su desplazamiento es ____.`,
        options: ["14 m", "6 m", "-6 m"],
        answer: 2,
        explanation: "El desplazamiento es posición final menos inicial: 4 − 10 = −6 m, no la distancia recorreida.",
      },
    ],
  };
}

function createFakeStructuredAdapter(config: ResolvedModelsConfig, telemetry?: TelemetrySink): StructuredAdapter {
  return {
    async generateStructured<T>(params: StructuredCallParams<T>): Promise<StructuredCallResult<T>> {
      const servedBy: ModelRef = resolveChain(config, params.task)[0];
      // `T` is a generic type parameter here (unresolvable structurally) —
      // the caller (models/assess.ts / models/judge.ts) always passes its
      // OWN concrete schema, and this module hand-mirrors those two exact
      // shapes above; the cast is the same narrow, documented pattern
      // structured.ts itself uses for its providerOptions double-cast.
      // Diseño de dos modelos (2026-08-11): "mastery-assessor" usa el MISMO
      // schema y prompt que "assessor" (misma rúbrica v3, distinta cadena) —
      // el fake lo trata igual.
      const object = (
        params.task === "guided-items"
          ? fakeGuidedItemsObject(params.prompt)
          : params.task === "assessor" || params.task === "mastery-assessor"
          ? fakeAssessorObject(params.prompt)
          : fakeJudgeObject(params.prompt)
      ) as unknown as T;

      // Computed unconditionally (not just when `telemetry` is passed) —
      // models/assess.ts and models/judge.ts now read `costUsd` straight off
      // the returned `StructuredCallResult` (TODOS.md "deuda F1/WP5"),
      // mirroring what the real adapter (execution/structured.ts) does.
      const capabilities = requireCapabilities(params.task, servedBy);
      const inputTokens = estimateFakeTokens(params.prompt);
      const outputTokens = estimateFakeTokens(JSON.stringify(object));
      const costUsd = estimateCostUsd(capabilities, inputTokens, outputTokens);

      if (telemetry) {
        telemetry.record({
          type: "model_call",
          task: params.task,
          environment: config.environment,
          servedBy,
          attemptIndex: 0,
          latencyMs: 0,
          inputTokens,
          outputTokens,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          costUsd,
          promptVersion: params.promptVersion ?? null,
          timestamp: new Date().toISOString(),
        });
      }

      return { ok: true, object, servedBy, promptVersion: params.promptVersion ?? null, costUsd };
    },
  };
}

// ---------------------------------------------------------------------------
// Ingest (F2 WQ1 Tier-2 page transcription) — canned markdown transcription.
// ---------------------------------------------------------------------------

/** Deliberately generic/inert content — BUXO_FAKE_MODELS mode never sees a real page image, so there is nothing real to "transcribe". */
const FAKE_INGEST_TRANSCRIPTION =
  "# [fake] Página transcrita\n\nContenido de marcador de posición generado por BUXO_FAKE_MODELS=1 — ninguna llamada real a un modelo de visión ocurrió.";

function createFakeIngestAdapter(config: ResolvedModelsConfig, telemetry?: TelemetrySink): IngestAdapter {
  return {
    async transcribeImage(params: IngestCallParams): Promise<IngestTranscription> {
      const servedBy: ModelRef = resolveChain(config, "ingest")[0];
      const text = FAKE_INGEST_TRANSCRIPTION;

      if (telemetry) {
        const capabilities = requireCapabilities("ingest", servedBy);
        const inputTokens = estimateFakeTokens(params.prompt);
        const outputTokens = estimateFakeTokens(text);
        telemetry.record({
          type: "model_call",
          task: "ingest",
          environment: config.environment,
          servedBy,
          attemptIndex: 0,
          latencyMs: 0,
          inputTokens,
          outputTokens,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          costUsd: estimateCostUsd(capabilities, inputTokens, outputTokens),
          promptVersion: params.promptVersion,
          timestamp: new Date().toISOString(),
        });
      }

      return { text, servedBy, promptVersion: params.promptVersion };
    },
  };
}

// ---------------------------------------------------------------------------
// Temario-builder (P2) — deterministic fake loop over provider-agnostic tools.
// ---------------------------------------------------------------------------

function createFakeTemarioBuilderAdapter(config: ResolvedModelsConfig): TemarioBuilderAdapter {
  return {
    async generateTemario(params: TemarioBuilderCallParams): Promise<TemarioBuilderResult> {
      const servedBy: ModelRef = resolveChain(config, "temario-builder")[0];
      const capabilities = requireCapabilities("temario-builder", servedBy);
      const ctx = params.toolContext;

      if (params.prompt.includes("__FAKE_NO_TOOL_SUPPORT__")) {
        throw new Error("this provider does not support tool calling");
      }

      if (params.prompt.includes("__FAKE_EMPTY__")) {
        return {
          text: "",
          servedBy,
          promptVersion: params.promptVersion,
          usage: { inputTokens: 100, outputTokens: 10 },
          costUsd: 0,
        };
      }

      const match = params.prompt.match(/Fake topics:\s*([^\n]+)/);
      const titles = match
        ? match[1]
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : ["Tema 1", "Tema 2", "Tema 3"];

      const createTopic = params.tools.find((t) => t.name === "createTopic");
      if (!createTopic) throw new Error("fake_temario_builder: createTopic tool not found");

      // P2 FIX3 (2026-07-21): subjectId is no longer a tool input — the
      // real tool executors read it off `ctx.subjectId` (set by the route
      // from the caller's ownership-checked Subject), so it's dropped from
      // every fake tool call below too.
      //
      // P2 FIX2: `titles` may contain a duplicate on purpose (route-level
      // fake-mode reproduction of the real-run bug — see
      // `temarios-generate.test.ts`'s "survives a duplicated tool call"
      // test). `createTopic` dedups by title, so the milestone must name the
      // LAST topic actually created — not just `titles[titles.length - 1]`,
      // which could be the duplicate itself.
      //
      // Bugfix (2026-07-25): `createMilestone` now takes
      // `coversUpToTopicTitle` (a title the server resolves), not a numeric
      // `coversUpToOrder` the caller has to count — mirrors the real tool
      // contract so the fake path exercises the same shape a real model sees.
      const seenTitles = new Set<string>();
      const uniqueTitlesInOrder: string[] = [];
      for (const title of titles) {
        const key = title.trim().toLowerCase();
        if (!seenTitles.has(key)) {
          seenTitles.add(key);
          uniqueTitlesInOrder.push(title);
        }
      }
      for (const title of titles) {
        await createTopic.execute(ctx, { title });
      }

      const createMilestone = params.tools.find((t) => t.name === "createMilestone");
      if (createMilestone && uniqueTitlesInOrder.length > 0) {
        await createMilestone.execute(ctx, {
          title: "Parcial acumulativo",
          kind: "parcial",
          coversUpToTopicTitle: uniqueTitlesInOrder[uniqueTitlesInOrder.length - 1],
        });
      }

      const inputTokens = 1000 + params.prompt.length;
      const outputTokens = 200;
      const costUsd = estimateCostUsd(capabilities, inputTokens, outputTokens);

      return {
        text: `[fake] Temario generado con ${titles.length} tema(s) y 1 hito`,
        servedBy,
        promptVersion: params.promptVersion,
        usage: { inputTokens, outputTokens },
        costUsd,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory — same shape src/models/adapters.ts's createModelAdapters returns.
// ---------------------------------------------------------------------------

export function createFakeModelAdapters(config: ResolvedModelsConfig, environment: Environment): ModelAdapters {
  return {
    tutorAdapter: createFakeTutorAdapter(config),
    milestoneAdapter: createFakeMilestoneAdapter(config),
    structuredAdapter: createFakeStructuredAdapter(config),
    temarioBuilderAdapter: createFakeTemarioBuilderAdapter(config),
    raw: {
      config,
      resolveProvider: fakeProviderResolver,
      environment,
      createStructuredAdapter: (telemetry) => createFakeStructuredAdapter(config, telemetry),
      createIngestAdapter: (telemetry) => createFakeIngestAdapter(config, telemetry),
    },
  };
}
