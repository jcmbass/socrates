/**
 * Study-material truncation (design doc MVP scope item #5).
 *
 * Token estimate is the chars/4 heuristic, explicit and documented in the
 * design doc rather than hidden. Budget is ~32K tokens total; when the
 * material is over budget we keep the first 16K + last 16K tokens (the full
 * 32K budget, head + tail) and drop the middle, because lecture-note key
 * theorems/derivations can sit anywhere in the document.
 *
 * Raised from 8K/4K+4K (docs/plan-local-litert/03-fase-1-nucleo-deteccion.md,
 * fase 0): the tiered ingest pipeline produces cleaner, more compact
 * material than raw whole-PDF transcription, so a larger budget still tends
 * to truncate less than before, not more. Tutor models also have ample
 * context windows, and with prompt caching a large material block is cheap
 * from the second turn onward — the cache hit absorbs the cost, so a bigger
 * head+tail budget doesn't meaningfully raise per-session spend.
 */

export const CHARS_PER_TOKEN = 4;
export const MAX_TOKENS = 32000;
export const HEAD_TOKENS = 16000;
export const TAIL_TOKENS = 16000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
  /** Estimated tokens dropped from the middle. 0 when not truncated. */
  droppedTokens: number;
}

export function truncateMaterial(raw: string): TruncateResult {
  if (raw.length === 0) {
    return { text: "", truncated: false, droppedTokens: 0 };
  }

  const totalTokens = estimateTokens(raw);
  if (totalTokens <= MAX_TOKENS) {
    return { text: raw, truncated: false, droppedTokens: 0 };
  }

  const headChars = HEAD_TOKENS * CHARS_PER_TOKEN;
  const tailChars = TAIL_TOKENS * CHARS_PER_TOKEN;

  const head = raw.slice(0, headChars);
  const tail = raw.slice(raw.length - tailChars);
  const middleChars = raw.length - headChars - tailChars;
  const droppedTokens = Math.max(0, Math.ceil(middleChars / CHARS_PER_TOKEN));

  return {
    text: `${head}\n\n[...material truncated...]\n\n${tail}`,
    truncated: true,
    droppedTokens,
  };
}
