/**
 * Transcription prompt for the server-side Tier-2 raster path (F2 WQ1).
 * Server's own copy — same reasoning as `../pdf/types.ts`'s docblock
 * (`apps/harness` has no package boundary to import from); ported from
 * `apps/harness/lib/ingest/prompt.ts`'s `INGEST_PROMPT` (page mode) with the
 * figure-mode variant dropped (see `../pdf/parse-node.ts`'s module doc:
 * embedded-figure crop transcription is out of scope for this wave).
 *
 * `INGEST_PROMPT_VERSION` — same role as the harness's constant: bump it
 * whenever the prompt text changes (O-9 provenance, persisted onto each
 * `ProcessingReport`-equivalent row).
 */
export const INGEST_PROMPT_VERSION = "buxo-server-ingest-v1";

export const INGEST_PAGE_PROMPT = `Transcribe this document page COMPLETELY to Markdown. This is a faithful
transcription, not a summary — every paragraph, definition, example, and
exercise on the page must appear in your output.

Rules:
- Keep the source language of the document. Do not translate anything.
- Mirror the page's own heading structure using Markdown headings
  (#, ##, ### ...) — do not invent a different structure.
- Write all mathematics as LaTeX: inline math in $...$ and display equations
  in $$...$$ (the app renders these with remark-math/rehype-katex).
- For every figure, graph, or diagram, insert a blockquote starting with
  "> **[Figura]**" followed by a faithful textual description: the axes and
  their labels, the shape and behavior of any curves, notable points
  (intercepts, maxima/minima, asymptotes), and what the figure illustrates.
  Do the same for any table that cannot be represented as text — but prefer
  a real Markdown table whenever the content fits one.
- Skip page headers, footers, and page numbers — they are not part of the
  document's content.

Output ONLY the transcription. No preamble, no closing commentary, no notes
about what you did.`;

/**
 * `subject` prepends a one-line context sentence, same pattern as the
 * harness's `resolveIngestPrompt` — lets the model use domain vocabulary.
 */
export function resolveIngestPagePrompt(subject?: string): string {
  if (!subject) return INGEST_PAGE_PROMPT;
  return `This page is from study material for: ${subject}.\n\n${INGEST_PAGE_PROMPT}`;
}
