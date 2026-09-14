/**
 * P5 (DF-P12/DF-P11) — builds the tutor/milestone-adapter context out of a
 * subject's Fuentes (text-only, `@buxo/domain/fuente`), recomputed FRESH on
 * every turn (`routes/sessions.ts`'s `POST /:id/exchanges`) rather than
 * cached at session-creation time like `./snapshot.ts`'s
 * `materialSnapshotTextRef` — Fuentes are materia-level and reusable/
 * editable across every topic/milestone session (DF-P11: "una fuente vive a
 * nivel materia y sirve para todos sus temas"), so a Fuente added mid-chat
 * must show up in the very next turn without any extra "attach" step (see
 * `apps/mobile/components/SourcesModal.tsx`'s module doc for the client
 * side of this — creating a Fuente there is the ENTIRE wiring; there is no
 * `attachFuenteToSession` call to make it visible to the tutor).
 *
 * plan-modal-rag F0 / F0.1 — `truncateMaterial` returns `truncated` /
 * `droppedTokens`. Builders stay **pure**: they return `{ text, metrics }`,
 * keep the JSON log for live grepping, and never touch the DB. The route
 * persists metrics fire-and-forget (F0.1).
 */
import { estimateTokens, truncateMaterial } from "@buxo/core/truncate";
import type { Fuente } from "@buxo/domain/fuente";

/** Correlatable ids for F0 measurement — UUIDs only, never material text. */
export type FuentesContextLogMeta = {
  subjectId?: string;
  sessionId?: string;
  /** Session kind as stored on study_sessions (`topic` | `milestone`). */
  kind?: string;
};

/** Numbers-only truncation snapshot — safe to persist / log. */
export type FuentesContextMetrics = {
  builder: "fuentes" | "topic";
  subjectId?: string;
  sessionId?: string;
  kind?: string;
  fuenteCount: number;
  corpusTokens: number;
  truncated: boolean;
  droppedTokens: number;
};

export type FuentesContextBuild = {
  text: string;
  metrics: FuentesContextMetrics;
};

/** One Fuente's text, labeled with its display name so a cited answer can point back at "Guía de Geometría.pdf" instead of an anonymous blob. */
function renderFuente(fuente: Fuente): string {
  return `### ${fuente.name}\n\n${fuente.text}`;
}

function joinFuentes(fuentes: readonly Fuente[]): string {
  return fuentes.map(renderFuente).join("\n\n---\n\n");
}

function logFuentesContext(metrics: FuentesContextMetrics): void {
  // Same shape as raster.adaptive_scale — one JSON line, grep-friendly in Render.
  console.info(
    JSON.stringify({
      msg: "material.fuentes_context",
      ...metrics,
    }),
  );
}

function metricsFrom(
  builder: "fuentes" | "topic",
  meta: FuentesContextLogMeta | undefined,
  fuenteCount: number,
  corpusTokens: number,
  truncated: boolean,
  droppedTokens: number,
): FuentesContextMetrics {
  return {
    builder,
    subjectId: meta?.subjectId,
    sessionId: meta?.sessionId,
    kind: meta?.kind,
    fuenteCount,
    corpusTokens,
    truncated,
    droppedTokens,
  };
}

/**
 * Truncated (head+tail budget, `@buxo/core/truncate`) concatenation of every
 * Fuente's text — `undefined` when the subject has none yet, matching the
 * "no material" contract `TutorCallParams.material`/`MilestoneCallParams.sourcesText`
 * already expect (both treat a missing/empty string as "nothing to ground on").
 */
export function buildFuentesSourceText(
  fuentes: readonly Fuente[],
  meta?: FuentesContextLogMeta,
): FuentesContextBuild | undefined {
  const combined = joinFuentes(fuentes);
  if (combined.length === 0) return undefined;
  const result = truncateMaterial(combined);
  const metrics = metricsFrom(
    "fuentes",
    meta,
    fuentes.length,
    estimateTokens(combined),
    result.truncated,
    result.droppedTokens,
  );
  logFuentesContext(metrics);
  return { text: result.text, metrics };
}

/**
 * Full `TutorCallParams.material` for a TOPIC session (DF-P12: "el tutor se
 * apoya en las fuentes de la materia + el tema actual"): the current
 * topic's title (so the tutor knows what's being studied even if the
 * student never says it), the subject's Fuentes, and — for backward
 * compatibility with the pre-P5 mid-session material-asset flow
 * (`MaterialIngestBar.tsx`, untouched by P5) — the session's own
 * `materialSnapshotTextRef`, all three combined then re-truncated as ONE
 * budget (re-truncating an already-truncated snapshot is harmless: the
 * budget is generous, ~32K tokens, and this only re-applies head+tail on
 * the concatenation).
 */
export function buildTopicSessionContext(input: {
  topicTitle: string | null;
  fuentes: readonly Fuente[];
  materialSnapshotTextRef: string | null;
  /** Optional F0 measurement meta — does not affect the returned text. */
  meta?: FuentesContextLogMeta;
}): FuentesContextBuild | undefined {
  const parts: string[] = [];
  if (input.topicTitle) parts.push(`Tema actual: ${input.topicTitle}`);
  const fuentesText = joinFuentes(input.fuentes);
  if (fuentesText.length > 0) parts.push(`Fuentes de la materia:\n\n${fuentesText}`);
  if (input.materialSnapshotTextRef) parts.push(input.materialSnapshotTextRef);

  if (parts.length === 0) return undefined;
  const combined = parts.join("\n\n---\n\n");
  const result = truncateMaterial(combined);
  const metrics = metricsFrom(
    "topic",
    input.meta,
    input.fuentes.length,
    estimateTokens(combined),
    result.truncated,
    result.droppedTokens,
  );
  logFuentesContext(metrics);
  return { text: result.text, metrics };
}
