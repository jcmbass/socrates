/**
 * Session — a retomable (resumable) tutoring session, extending the
 * existing one-shot `SessionTranscript` (lib/transcript.ts, which stays a
 * download-and-forget export format) into a model the app can persist and
 * reload mid-conversation.
 *
 * Design context: docs/plan-harness-autonomo/00-contexto-y-arquitectura.md
 * §4, spec: docs/plan-harness-autonomo/01-fase-1-sesiones-persistencia.md.
 * Reuses `Exchange`/`MaterialEvent`/`MaterialInfo`/`Band` from
 * lib/transcript.ts and lib/prompts.ts rather than duplicating them — this
 * module only adds what a resumable session needs on top: a stable id,
 * chat history (`messages`), richer `BandChange` (with `source`/
 * `rationale` for the fase-2 auto-tune), `Assessment` (defined here for
 * fase 2 to fill in; this fase only types + serializes it), and the raw
 * `materialText` needed to restore grounding on resume.
 *
 * ---------------------------------------------------------------------
 * PRIVACY BY DESIGN (docs/plan-harness-autonomo/00-contexto-y-arquitectura.md
 * §4 "Privacidad por diseño"): session files contain a student's (possibly
 * a minor's) free-text messages and the tutoring material they uploaded.
 * That text is confined to the `Session` object end to end — constructed
 * here, written verbatim by `FileSessionStore` (lib/sessionStore.ts) to
 * `sessions/<id>.json` — and MUST NOT be copied into server logs,
 * analytics events, or error messages thrown by this module or its
 * callers. `deserializeSession`'s validation errors below intentionally
 * report only shapes/types/field names, never field values, for exactly
 * this reason.
 * ---------------------------------------------------------------------
 */
import type { Band } from "@buxo/core/prompts";
import { BANDS, PROMPT_VERSION } from "@buxo/core/prompts";
import type { Exchange, MaterialEvent, MaterialInfo } from "./transcript";

export type BandChangeSource = "auto" | "manual" | "initial";

export interface BandChange {
  band: Band;
  timestamp: string;
  /** NEW vs. transcript.ts's BandChange: who/what moved the band. */
  source: BandChangeSource;
  /** NEW — why (auto only). Goes to logs/founder panel, never to the student. */
  rationale?: string;
}

const DEMONSTRATED_UNDERSTANDING_LEVELS = ["none", "weak", "developing", "solid"] as const;
export type DemonstratedUnderstanding = (typeof DEMONSTRATED_UNDERSTANDING_LEVELS)[number];

/**
 * Out-of-band judgment of a student's demonstrated (not declared)
 * understanding after one exchange. Defined here because `Session` stores
 * an array of these; the assessor call that PRODUCES an Assessment is
 * fase 2's job (docs/plan-harness-autonomo/02-fase-2-assessor-autotune.md)
 * — nothing in this file calls Anthropic.
 */
export interface Assessment {
  exchangeIndex: number;
  timestamp: string;
  demonstratedUnderstanding: DemonstratedUnderstanding;
  explainedInOwnWords: boolean;
  guessedOrPatternMatched: boolean;
  recommendedBand: Band;
  rationale: string;
}

/** Serializable chat message, for rehydrating useChat's message list on resume. */
export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface Session {
  /** Stable, time-ordered id — see newSessionId(). */
  id: string;
  createdAt: string;
  updatedAt: string;
  subject: string;
  initialBand: Band;
  messages: StoredMessage[];
  exchanges: Exchange[];
  bandChanges: BandChange[];
  assessments: Assessment[];
  material: MaterialInfo | null;
  materialEvents: MaterialEvent[];
  /** The digested material text, so grounding can be restored on resume. */
  materialText: string;
  promptVersion: string;
}

/** Lightweight shape for the "resume a session" list — no message/material bodies. */
export interface SessionSummary {
  id: string;
  subject: string;
  createdAt: string;
  updatedAt: string;
  exchangeCount: number;
}

// ---------------------------------------------------------------------------
// newSessionId
// ---------------------------------------------------------------------------

/**
 * Format: `<compact-ISO-timestamp>-<8-hex-char suffix>`, e.g.
 * `20260710T211500123Z-a1b2c3d4`. The compact-ISO prefix keeps ids sortable
 * by creation time as plain strings (useful for a stable default list
 * order and for eyeballing `sessions/*.json` on disk); the random suffix
 * avoids collisions between two sessions created within the same
 * millisecond. Filename-safe: no `:`, `.`, or `/`.
 */
export function newSessionId(now: Date = new Date()): string {
  const compact = now.toISOString().replace(/[-:]/g, "").replace(/\./g, "");
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${compact}-${suffix}`;
}

// ---------------------------------------------------------------------------
// emptySession / summarize
// ---------------------------------------------------------------------------

export function emptySession(input: {
  subject: string;
  initialBand: Band;
  id?: string;
  now?: Date;
}): Session {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  return {
    id: input.id ?? newSessionId(now),
    createdAt: timestamp,
    updatedAt: timestamp,
    subject: input.subject,
    initialBand: input.initialBand,
    messages: [],
    exchanges: [],
    bandChanges: [{ band: input.initialBand, timestamp, source: "initial" }],
    assessments: [],
    material: null,
    materialEvents: [],
    materialText: "",
    promptVersion: PROMPT_VERSION,
  };
}

export function summarize(session: Session): SessionSummary {
  return {
    id: session.id,
    subject: session.subject,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    exchangeCount: session.exchanges.length,
  };
}

// ---------------------------------------------------------------------------
// serializeSession / deserializeSession (round-trip, defensive validation)
// ---------------------------------------------------------------------------

export function serializeSession(session: Session): string {
  return JSON.stringify(session, null, 2);
}

/**
 * Thrown by deserializeSession/parseSession on any structurally invalid
 * input. Callers (FileSessionStore.list/load, the API routes) turn this
 * into "skip the file" or a 4xx response rather than letting a corrupt
 * session file crash the server (spec, fase-1 §"criterios de aceptación").
 * Message intentionally names only fields/types, never field values (see
 * the privacy-by-design note at the top of this file).
 */
export class InvalidSessionError extends Error {
  constructor(message: string) {
    super(`Invalid session: ${message}`);
    this.name = "InvalidSessionError";
  }
}

function fail(message: string): never {
  throw new InvalidSessionError(message);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isBand(v: unknown): v is Band {
  return typeof v === "string" && (BANDS as readonly string[]).includes(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateStoredMessage(v: unknown, index: number): StoredMessage {
  if (!isPlainObject(v)) fail(`messages[${index}] is not an object`);
  if (v.role !== "user" && v.role !== "assistant") fail(`messages[${index}].role is invalid`);
  if (!isString(v.content)) fail(`messages[${index}].content is not a string`);
  if (!isString(v.timestamp)) fail(`messages[${index}].timestamp is not a string`);
  return { role: v.role, content: v.content, timestamp: v.timestamp };
}

function validateExchange(v: unknown, index: number): Exchange {
  if (!isPlainObject(v)) fail(`exchanges[${index}] is not an object`);
  if (!isString(v.studentMessage)) fail(`exchanges[${index}].studentMessage is not a string`);
  if (!isString(v.tutorReply)) fail(`exchanges[${index}].tutorReply is not a string`);
  if (!isBand(v.band)) fail(`exchanges[${index}].band is invalid`);
  if (!isString(v.timestamp)) fail(`exchanges[${index}].timestamp is not a string`);
  if (v.hintOffered !== null && !isBoolean(v.hintOffered)) {
    fail(`exchanges[${index}].hintOffered is invalid`);
  }
  if (v.studentCorrect !== null && !isBoolean(v.studentCorrect)) {
    fail(`exchanges[${index}].studentCorrect is invalid`);
  }
  return {
    studentMessage: v.studentMessage,
    tutorReply: v.tutorReply,
    band: v.band,
    timestamp: v.timestamp,
    hintOffered: v.hintOffered as boolean | null,
    studentCorrect: v.studentCorrect as boolean | null,
  };
}

function validateBandChange(v: unknown, index: number): BandChange {
  if (!isPlainObject(v)) fail(`bandChanges[${index}] is not an object`);
  if (!isBand(v.band)) fail(`bandChanges[${index}].band is invalid`);
  if (!isString(v.timestamp)) fail(`bandChanges[${index}].timestamp is not a string`);
  if (v.source !== "auto" && v.source !== "manual" && v.source !== "initial") {
    fail(`bandChanges[${index}].source is invalid`);
  }
  if (v.rationale !== undefined && !isString(v.rationale)) {
    fail(`bandChanges[${index}].rationale is not a string`);
  }
  const result: BandChange = { band: v.band, timestamp: v.timestamp, source: v.source };
  if (v.rationale !== undefined) result.rationale = v.rationale;
  return result;
}

function validateAssessment(v: unknown, index: number): Assessment {
  if (!isPlainObject(v)) fail(`assessments[${index}] is not an object`);
  if (typeof v.exchangeIndex !== "number") fail(`assessments[${index}].exchangeIndex is not a number`);
  if (!isString(v.timestamp)) fail(`assessments[${index}].timestamp is not a string`);
  if (
    typeof v.demonstratedUnderstanding !== "string" ||
    !(DEMONSTRATED_UNDERSTANDING_LEVELS as readonly string[]).includes(v.demonstratedUnderstanding)
  ) {
    fail(`assessments[${index}].demonstratedUnderstanding is invalid`);
  }
  if (!isBoolean(v.explainedInOwnWords)) fail(`assessments[${index}].explainedInOwnWords is not a boolean`);
  if (!isBoolean(v.guessedOrPatternMatched)) {
    fail(`assessments[${index}].guessedOrPatternMatched is not a boolean`);
  }
  if (!isBand(v.recommendedBand)) fail(`assessments[${index}].recommendedBand is invalid`);
  if (!isString(v.rationale)) fail(`assessments[${index}].rationale is not a string`);
  return {
    exchangeIndex: v.exchangeIndex,
    timestamp: v.timestamp,
    demonstratedUnderstanding: v.demonstratedUnderstanding as DemonstratedUnderstanding,
    explainedInOwnWords: v.explainedInOwnWords,
    guessedOrPatternMatched: v.guessedOrPatternMatched,
    recommendedBand: v.recommendedBand,
    rationale: v.rationale,
  };
}

function validateMaterialInfo(v: unknown): MaterialInfo | null {
  if (v === null) return null;
  if (!isPlainObject(v)) fail("material is neither null nor an object");
  if (!isBoolean(v.truncated)) fail("material.truncated is not a boolean");
  if (typeof v.droppedTokens !== "number") fail("material.droppedTokens is not a number");
  return { truncated: v.truncated, droppedTokens: v.droppedTokens };
}

const MATERIAL_EVENT_KINDS = ["paste", "txt", "pdf"] as const;
const MATERIAL_EVENT_ACTIONS = ["added", "removed"] as const;

function validateMaterialEvent(v: unknown, index: number): MaterialEvent {
  if (!isPlainObject(v)) fail(`materialEvents[${index}] is not an object`);
  if (!isString(v.timestamp)) fail(`materialEvents[${index}].timestamp is not a string`);
  if (!isString(v.source)) fail(`materialEvents[${index}].source is not a string`);
  if (typeof v.kind !== "string" || !(MATERIAL_EVENT_KINDS as readonly string[]).includes(v.kind)) {
    fail(`materialEvents[${index}].kind is invalid`);
  }
  if (typeof v.action !== "string" || !(MATERIAL_EVENT_ACTIONS as readonly string[]).includes(v.action)) {
    fail(`materialEvents[${index}].action is invalid`);
  }
  return {
    timestamp: v.timestamp,
    source: v.source,
    kind: v.kind as MaterialEvent["kind"],
    action: v.action as MaterialEvent["action"],
  };
}

function validateArray<T>(v: unknown, field: string, item: (el: unknown, i: number) => T): T[] {
  if (!Array.isArray(v)) fail(`${field} is not an array`);
  return v.map(item);
}

/**
 * Structural validation shared by deserializeSession and the persistence
 * layer (FileSessionStore reads raw JSON off disk; the POST /api/sessions
 * route reads a raw request body) — both need "is this a real Session"
 * without re-parsing JSON that's already an object.
 */
export function parseSession(value: unknown): Session {
  if (!isPlainObject(value)) fail("root value is not an object");

  if (!isString(value.id) || value.id.length === 0) fail("id is not a non-empty string");
  if (!isString(value.createdAt)) fail("createdAt is not a string");
  if (!isString(value.updatedAt)) fail("updatedAt is not a string");
  if (!isString(value.subject)) fail("subject is not a string");
  if (!isBand(value.initialBand)) fail("initialBand is invalid");
  if (!isString(value.materialText)) fail("materialText is not a string");
  if (!isString(value.promptVersion)) fail("promptVersion is not a string");

  return {
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    subject: value.subject,
    initialBand: value.initialBand,
    messages: validateArray(value.messages, "messages", validateStoredMessage),
    exchanges: validateArray(value.exchanges, "exchanges", validateExchange),
    bandChanges: validateArray(value.bandChanges, "bandChanges", validateBandChange),
    assessments: validateArray(value.assessments, "assessments", validateAssessment),
    material: validateMaterialInfo(value.material),
    materialEvents: validateArray(value.materialEvents, "materialEvents", validateMaterialEvent),
    materialText: value.materialText,
    promptVersion: value.promptVersion,
  };
}

export function deserializeSession(json: string): Session {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail("not valid JSON");
  }
  return parseSession(parsed);
}
