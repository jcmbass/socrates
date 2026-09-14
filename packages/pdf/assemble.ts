/**
 * Reading-order material assembler (docs/plan-local-litert §5, fase 1).
 *
 * Pure, deterministic merge of heterogeneous blocks — local pdf.js text,
 * Haiku figure descriptions, and full-page Haiku transcriptions — into a
 * single markdown string in reading order. The reader (and the tutor) can't
 * tell what came from where, except the honest `[Figura: ...]` marker.
 */

export type MaterialBlock =
  | { kind: "text"; pageNumber: number; y: number; markdown: string }
  | { kind: "figure"; pageNumber: number; y: number; description: string }
  | { kind: "cloud-page"; pageNumber: number; markdown: string };

/**
 * Blocks are ordered by `pageNumber` ascending, then by vertical position
 * descending (page coordinates: y grows upward, so "descending" means
 * top-of-page first). A `cloud-page` block has no y of its own — it stands
 * for the whole page — so it sorts to the very top of its page, ahead of
 * any other block that might (in principle) share the page number.
 */
function sortKeyY(block: MaterialBlock): number {
  return block.kind === "cloud-page" ? Infinity : block.y;
}

function renderBlock(block: MaterialBlock): string {
  switch (block.kind) {
    case "text":
      return block.markdown;
    case "figure":
      return `\n\n[Figura: ${block.description}]\n\n`;
    case "cloud-page":
      return block.markdown;
  }
}

/** Collapses 3+ consecutive newlines (however they got introduced) down to a single blank line. */
function normalizeNewlines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function assembleMaterial(blocks: MaterialBlock[]): string {
  const ordered = [...blocks].sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    return sortKeyY(b) - sortKeyY(a);
  });

  const rendered = ordered.map(renderBlock).join("\n\n");
  return normalizeNewlines(rendered);
}
