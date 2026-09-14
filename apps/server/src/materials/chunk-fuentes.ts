/**
 * plan-modal-rag F2 — split Fuente text into overlapping chunks for embedding.
 *
 * Pure: no DB, no Modal. Configurable size/overlap (defaults are starting
 * points; F3 measures quality against real conversations — do not tune here).
 *
 * Each chunk keeps `fuenteName` so F3 can cite "Guía de Química" without a join.
 * Subject scope (D4) is the caller's responsibility via `subjectId`.
 */
import { CHARS_PER_TOKEN, estimateTokens } from "@buxo/core/truncate";

export type ChunkConfig = {
  /** Target chunk size in tokens (chars/4 heuristic). Default 600. */
  targetTokens?: number;
  /** Overlap as a fraction of targetTokens. Default 0.15. */
  overlapRatio?: number;
};

export const DEFAULT_CHUNK_TARGET_TOKENS = 600;
export const DEFAULT_CHUNK_OVERLAP_RATIO = 0.15;

export type FuenteChunkDraft = {
  subjectId: string;
  fuenteId: string;
  fuenteName: string;
  chunkIndex: number;
  text: string;
  tokenEstimate: number;
};

export type ChunkFuenteInput = {
  subjectId: string;
  fuenteId: string;
  fuenteName: string;
  /** Raw Fuente body (without the `### name` header — we re-attach the name). */
  text: string;
};

function resolveConfig(config?: ChunkConfig): { targetTokens: number; overlapTokens: number } {
  const targetTokens = Math.max(64, config?.targetTokens ?? DEFAULT_CHUNK_TARGET_TOKENS);
  const ratio = config?.overlapRatio ?? DEFAULT_CHUNK_OVERLAP_RATIO;
  const overlapTokens = Math.max(0, Math.min(targetTokens - 1, Math.floor(targetTokens * ratio)));
  return { targetTokens, overlapTokens };
}

/**
 * Prefer paragraph / heading boundaries when cheap; fall back to hard cuts.
 * Headings that look like markdown (`#…`) or ALL-CAPS short lines start a unit.
 */
function splitIntoUnits(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [];

  const paragraphs = normalized.split(/\n{2,}/);
  const units: string[] = [];
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length === 0) continue;
    // Keep a single paragraph as one unit when it fits; oversized ones split by line.
    if (estimateTokens(trimmed) <= DEFAULT_CHUNK_TARGET_TOKENS * 2) {
      units.push(trimmed);
      continue;
    }
    const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
    let buf = "";
    for (const line of lines) {
      const candidate = buf.length === 0 ? line : `${buf}\n${line}`;
      if (buf.length > 0 && estimateTokens(candidate) > DEFAULT_CHUNK_TARGET_TOKENS) {
        units.push(buf);
        buf = line;
      } else {
        buf = candidate;
      }
    }
    if (buf.length > 0) units.push(buf);
  }
  return units;
}

function hardCut(text: string, targetTokens: number): string[] {
  const targetChars = targetTokens * CHARS_PER_TOKEN;
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + targetChars));
    i += targetChars;
  }
  return out.filter((s) => s.trim().length > 0);
}

/**
 * Pack units into overlapping windows of ~targetTokens.
 * Every emitted chunk is prefixed with `### <fuenteName>` for traceability.
 */
export function chunkFuente(input: ChunkFuenteInput, config?: ChunkConfig): FuenteChunkDraft[] {
  const { targetTokens, overlapTokens } = resolveConfig(config);
  const header = `### ${input.fuenteName}`;
  const body = input.text.trim();
  if (body.length === 0) return [];

  const units = splitIntoUnits(body);
  const pieces: string[] = [];
  for (const unit of units) {
    if (estimateTokens(unit) <= targetTokens) {
      pieces.push(unit);
    } else {
      pieces.push(...hardCut(unit, targetTokens));
    }
  }

  if (pieces.length === 0) return [];

  const drafts: FuenteChunkDraft[] = [];
  let chunkIndex = 0;
  let i = 0;
  while (i < pieces.length) {
    const parts: string[] = [];
    let tokens = 0;
    let j = i;
    while (j < pieces.length) {
      const next = pieces[j]!;
      const nextTokens = estimateTokens(next);
      if (parts.length > 0 && tokens + nextTokens > targetTokens) break;
      parts.push(next);
      tokens += nextTokens;
      j += 1;
      if (tokens >= targetTokens) break;
    }

    const bodyText = parts.join("\n\n");
    const text = `${header}\n\n${bodyText}`;
    drafts.push({
      subjectId: input.subjectId,
      fuenteId: input.fuenteId,
      fuenteName: input.fuenteName,
      chunkIndex,
      text,
      tokenEstimate: estimateTokens(text),
    });
    chunkIndex += 1;

    if (j >= pieces.length) break;

    // Back up by ~overlapTokens worth of trailing pieces for the next window.
    if (overlapTokens <= 0) {
      i = j;
      continue;
    }
    let overlap = 0;
    let start = j;
    while (start > i && overlap < overlapTokens) {
      start -= 1;
      overlap += estimateTokens(pieces[start]!);
    }
    // Ensure progress even if a single piece exceeds overlap.
    i = start <= i ? j : start;
  }

  return drafts;
}

/** Chunk every Fuente in a subject corpus (order preserved). */
export function chunkFuentes(
  fuentes: readonly ChunkFuenteInput[],
  config?: ChunkConfig,
): FuenteChunkDraft[] {
  const out: FuenteChunkDraft[] = [];
  for (const f of fuentes) {
    out.push(...chunkFuente(f, config));
  }
  return out;
}
