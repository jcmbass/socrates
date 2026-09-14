#!/usr/bin/env tsx
/**
 * Sondeo: API nativa de Ollama Cloud (/api/chat) con format: <JSON Schema>
 * para el assessor buxo-assessor-v3.
 *
 * Lee 3 transcripts reales del golden set (ollama-001, ollama-004, ollama-014)
 * desde la session-data del comparativo Ollama, llama a la API nativa de
 * Ollama Cloud con format=<AssessorOutput schema>, y verifica si la respuesta
 * es JSON válido conforme al schema del assessor.
 *
 * Uso: tsx apps/server/scripts/sondeo-api-nativa-ollama.ts
 * Requiere: OLLAMA_API_KEY en apps/server/.env
 *
 * Co-Authored-By: Claude <noreply@anthropic.com>
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OLLAMA_CLOUD_BASE = "https://ollama.com";
const CHAT_ENDPOINT = `${OLLAMA_CLOUD_BASE}/api/chat`;
const MODEL = "gemma4:31b-cloud";

// Cargar API key desde .env
const envPath = resolve(__dirname, "..", ".env");
const envContent = readFileSync(envPath, "utf-8");
const apiKeyMatch = envContent.match(/^OLLAMA_API_KEY=(.+)$/m);
if (!apiKeyMatch) {
  console.error("FATAL: No se encontró OLLAMA_API_KEY en apps/server/.env");
  process.exit(1);
}
const OLLAMA_API_KEY = apiKeyMatch[1].trim();

// ---------------------------------------------------------------------------
// Assessor schema (JSON Schema, no Zod — para el format de Ollama)
// ---------------------------------------------------------------------------

const assessorJsonSchema = {
  type: "object",
  properties: {
    demonstratedUnderstanding: {
      type: "string",
      enum: ["none", "weak", "developing", "solid"],
    },
    explainedInOwnWords: { type: "boolean" },
    guessedOrPatternMatched: { type: "boolean" },
    recommendedBand: {
      type: "string",
      enum: ["guiding", "probing", "minimal"],
    },
    rationale: { type: "string" },
    topicKey: { type: ["string", "null"] },
  },
  required: [
    "demonstratedUnderstanding",
    "explainedInOwnWords",
    "guessedOrPatternMatched",
    "recommendedBand",
    "rationale",
    "topicKey",
  ],
  additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// Session data — cargar desde el archivo real
// ---------------------------------------------------------------------------

interface Exchange {
  id: string;
  index: number;
  studentMessage: string;
  tutorReply: string;
  band: string;
}

interface SessionData {
  exchanges: Exchange[];
}

const sessionDataPath = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "plan-app-multiplataforma",
  "reports",
  "wq5-evidence",
  "comparativo-ollama",
  "03-session-data.json",
);

const sessionData: SessionData = JSON.parse(
  readFileSync(sessionDataPath, "utf-8"),
);

// ---------------------------------------------------------------------------
// Build assessor input for a given exchange index
// ---------------------------------------------------------------------------

function buildAssessorInput(targetIndex: number) {
  const exchanges = sessionData.exchanges;
  const target = exchanges[targetIndex];
  if (!target) throw new Error(`Exchange index ${targetIndex} not found`);

  // All exchanges up to and including the target
  const relevantExchanges = exchanges.slice(0, targetIndex + 1);

  // Build messages array: each prior exchange contributes user+assistant
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const ex of relevantExchanges) {
    messages.push({ role: "user" as const, content: ex.studentMessage });
    messages.push({ role: "assistant" as const, content: ex.tutorReply });
  }

  return {
    messages,
    currentBand: target.band,
    exchangeId: target.id,
    index: target.index,
  };
}

// ---------------------------------------------------------------------------
// Build system prompt (buxo-assessor-v3 with topicLabeling + tutorLedRubric)
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  const profile = `Matematicas`; // subject from session data
  return `You are an out-of-band assessor for a Socratic ${profile} tutoring session. You observe the full conversation between the student and the tutor. Your job is to judge the student's DEMONSTRATED understanding — what they showed through their own reasoning — never their DECLARED understanding. A student saying "I get it now" or "ok, that makes sense" demonstrates nothing by itself.

Evaluate the student's LATEST message, in the context of the full trajectory so far (the conversation you are given typically ends with the tutor's reply to the student's latest message; the message you are assessing is the last one from the student).

Return six fields:

- demonstratedUnderstanding ("none" | "weak" | "developing" | "solid"): judge only from what the student has actually produced across the trajectory, weighting the most recent turns more heavily.
- explainedInOwnWords (boolean): true ONLY if, in their latest message, the student articulated reasoning or justification in their own words. Repeating the tutor's phrasing back, giving a bare final answer with no justification, or just agreeing ("sí", "ya veo", "ok") does NOT count.
- guessedOrPatternMatched (boolean): true if the latest message looks like a guess or mechanical pattern match — an answer with no justification, mimicry of the tutor's own words, or agreement with no substance behind it.
- recommendedBand ("guiding" | "probing" | "minimal"): recommend from the scaffolding perspective. "guiding" = frequent, directive support (understanding is none/weak, or repeated failed attempts). "probing" = developing understanding, open questions. "minimal" = ONLY when the student has demonstrated solid understanding (explains in their own words, self-corrects). Be conservative about recommending "minimal": declared confidence without demonstrated reasoning is NOT enough.
- rationale (string): 1-3 sentences for the founder's log, in the language of the conversation (most likely Spanish). This is never shown to the student.

- topicKey (string | null): a short label (a few words, in the language of the conversation) naming the specific topic or concept the student's latest message is actually about (e.g. "regla de la cadena", "equivalent fractions") — not the whole subject, a specific sub-topic within it. Return null if no specific topic is identifiable (e.g. the message is purely procedural/off-topic). This label does not need to match any prior label verbatim; it is normalized downstream.

TUTOR-LED CEILING RULES — apply these literally, as mechanical checks, not as adjectives:

1. Tutor-led ceiling: check whether the tutor supplied the method, the test values, or the structure of the solution in an EARLIER turn (not this one). If so, and the student's latest message executes that method/values/structure — even correctly — then demonstratedUnderstanding is capped at "developing" and recommendedBand is capped at "probing" for this turn, regardless of how correct the execution is. Correctly running a method the tutor just handed you is competence, not the student's own solid understanding.
2. Minimal rule: "minimal" requires ALL three to hold for THIS turn: (a) the reasoning is the student's own, not dictated by the tutor in an earlier turn; (b) the reasoning is correct; (c) explainedInOwnWords is true. Asking for confirmation after correct, self-generated reasoning does NOT by itself disqualify "minimal". Correct work that only carries out a method the tutor already gave DOES disqualify "minimal" — apply rule 1's ceiling instead.
3. Mechanical-verification rule: if the student's latest message only substitutes values into an expression because the tutor asked them to check/verify it, treat that as evidence of correct arithmetic execution, not conceptual understanding — demonstratedUnderstanding is capped at "developing" for this turn even when every substitution is correct (this is the golden-set ollama-004 pattern: verifying three solutions by direct substitution after the tutor requested the check).

You do NOT receive the study material — you judge the student's reasoning process, not factual accuracy (the judge and the tutor already cover that). This also keeps your evaluation cheap.`;
}

// ---------------------------------------------------------------------------
// Build user prompt
// ---------------------------------------------------------------------------

function buildUserPrompt(
  messages: { role: string; content: string }[],
  currentBand: string,
): string {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
    .join("\n\n");
  return `${transcript}\n\nCurrent scaffolding band: ${currentBand}. Assess the student's latest message.`;
}

// ---------------------------------------------------------------------------
// Call Ollama Cloud native API
// ---------------------------------------------------------------------------

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

async function callOllamaNative(
  messages: { role: string; content: string }[],
  system: string,
  schema: object,
): Promise<{ ok: boolean; data?: OllamaChatResponse; raw?: string; error?: string }> {
  const body = {
    model: MODEL,
    system,
    messages,
    format: schema,
    stream: false,
    options: {
      temperature: 0,
    },
  };

  try {
    const response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OLLAMA_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const rawText = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        raw: rawText,
        error: `HTTP ${response.status}: ${rawText.substring(0, 500)}`,
      };
    }

    let parsed: OllamaChatResponse;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return {
        ok: false,
        raw: rawText,
        error: `Response is not valid JSON: ${rawText.substring(0, 200)}`,
      };
    }

    return { ok: true, data: parsed, raw: rawText };
  } catch (err) {
    return {
      ok: false,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Validate response against assessor schema
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  parsed: unknown | null;
  errors: string[];
}

function validateAssessorResponse(content: string): ValidationResult {
  const errors: string[] = [];
  let parsed: unknown = null;

  // Try to parse as JSON
  try {
    parsed = JSON.parse(content);
  } catch {
    return { valid: false, parsed: null, errors: ["Response content is not valid JSON"] };
  }

  // Must be an object
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { valid: false, parsed, errors: ["Response is not a JSON object"] };
  }

  const obj = parsed as Record<string, unknown>;

  // Check required fields
  const requiredFields = [
    "demonstratedUnderstanding",
    "explainedInOwnWords",
    "guessedOrPatternMatched",
    "recommendedBand",
    "rationale",
    "topicKey",
  ];

  for (const field of requiredFields) {
    if (!(field in obj)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (errors.length > 0) return { valid: false, parsed, errors };

  // Validate types
  const duValues = ["none", "weak", "developing", "solid"];
  if (!duValues.includes(obj.demonstratedUnderstanding as string)) {
    errors.push(
      `demonstratedUnderstanding="${obj.demonstratedUnderstanding}" not in [${duValues.join(", ")}]`,
    );
  }

  if (typeof obj.explainedInOwnWords !== "boolean") {
    errors.push(
      `explainedInOwnWords is ${typeof obj.explainedInOwnWords}, expected boolean`,
    );
  }

  if (typeof obj.guessedOrPatternMatched !== "boolean") {
    errors.push(
      `guessedOrPatternMatched is ${typeof obj.guessedOrPatternMatched}, expected boolean`,
    );
  }

  const bandValues = ["guiding", "probing", "minimal"];
  if (!bandValues.includes(obj.recommendedBand as string)) {
    errors.push(
      `recommendedBand="${obj.recommendedBand}" not in [${bandValues.join(", ")}]`,
    );
  }

  if (typeof obj.rationale !== "string") {
    errors.push(`rationale is ${typeof obj.rationale}, expected string`);
  }

  if (obj.topicKey !== null && typeof obj.topicKey !== "string") {
    errors.push(
      `topicKey is ${typeof obj.topicKey}, expected string | null`,
    );
  }

  return { valid: errors.length === 0, parsed, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(72));
  console.log("SONDEO: API nativa de Ollama Cloud con format=<JSON Schema>");
  console.log(`Endpoint: ${CHAT_ENDPOINT}`);
  console.log(`Model: ${MODEL}`);
  console.log("=".repeat(72));
  console.log();

  // Pick 3 diverse transcripts from the golden set
  const transcriptSelections = [
    { label: "ollama-001 (exchange 0, first message)", index: 0 },
    { label: "ollama-004 (exchange 3, verification pattern)", index: 3 },
    { label: "ollama-014 (exchange 13, complex problem)", index: 13 },
  ];

  let validCount = 0;
  let totalCalls = 0;

  for (const sel of transcriptSelections) {
    totalCalls++;
    console.log(`--- [${totalCalls}/3] ${sel.label} ---`);

    const input = buildAssessorInput(sel.index);
    const system = buildSystemPrompt();
    const userPrompt = buildUserPrompt(input.messages, input.currentBand);

    console.log(`  currentBand: ${input.currentBand}`);
    console.log(`  messages: ${input.messages.length} (${input.messages.length / 2} exchanges)`);
    console.log(`  userPrompt length: ${userPrompt.length} chars`);
    console.log();

    console.log("  Calling Ollama Cloud native API...");
    const result = await callOllamaNative(
      input.messages,
      system,
      assessorJsonSchema,
    );

    if (!result.ok) {
      console.log(`  ERROR: ${result.error}`);
      if (result.raw) {
        console.log(`  Raw response (first 300 chars): ${result.raw.substring(0, 300)}`);
      }
      console.log(`  VEREDICTO: INVALIDO`);
      console.log();
      continue;
    }

    const content = result.data!.message.content;
    console.log(`  HTTP 200 OK`);
    console.log(`  Response content (first 200 chars): ${content.substring(0, 200)}`);
    console.log(`  Response length: ${content.length} chars`);
    console.log(`  Token usage: prompt=${result.data!.prompt_eval_count ?? "N/A"}, completion=${result.data!.eval_count ?? "N/A"}`);

    const validation = validateAssessorResponse(content);

    if (validation.valid) {
      validCount++;
      console.log(`  VALIDO — conforma el schema del assessor`);
      const v = validation.parsed as Record<string, unknown>;
      console.log(`    demonstratedUnderstanding: ${v.demonstratedUnderstanding}`);
      console.log(`    explainedInOwnWords: ${v.explainedInOwnWords}`);
      console.log(`    guessedOrPatternMatched: ${v.guessedOrPatternMatched}`);
      console.log(`    recommendedBand: ${v.recommendedBand}`);
      console.log(`    topicKey: ${v.topicKey}`);
      console.log(`    rationale: ${(v.rationale as string).substring(0, 120)}...`);
    } else {
      console.log(`  INVALIDO — ${validation.errors.length} error(es):`);
      for (const err of validation.errors) {
        console.log(`    - ${err}`);
      }
      if (validation.parsed) {
        console.log(`  Parsed object: ${JSON.stringify(validation.parsed, null, 2).substring(0, 300)}`);
      }
    }

    console.log();
  }

  // Summary
  console.log("=".repeat(72));
  console.log(`RESUMEN: ${validCount}/${totalCalls} válidos`);
  if (validCount === totalCalls) {
    console.log("VEREDICTO: PASS — la API nativa de Ollama Cloud funciona para nuestro assessor");
  } else if (validCount === 0) {
    console.log("VEREDICTO: FAIL — la API nativa de Ollama Cloud NO funciona para nuestro assessor");
  } else {
    console.log(`VEREDICTO: PARCIAL — ${validCount}/${totalCalls} válidos`);
  }
  console.log("=".repeat(72));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
