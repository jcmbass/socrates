/**
 * Material-snapshot combine+truncate — factored out of `routes/sessions.ts`'s
 * `POST /` handler (F2 WQ2 Part 2 deviation, see that route's module doc):
 * mid-session material attach (`POST /:id/materials`, the mobile client's
 * upload-mid-session flow, `docs/plan-app-multiplataforma/05-plan-f2.md`
 * Ola 2 WQ2) needs the EXACT SAME combine-then-truncate logic session
 * CREATION already uses — only "ready" materials contribute text (a
 * "partial"/"pending" material is still attached to the session for
 * bookkeeping, but its text is silently excluded until it's ready, same as
 * creation's existing behavior), concatenated in the order given, then
 * truncated via `@buxo/core/truncate`'s existing budget.
 */
import { truncateMaterial } from "@buxo/core/truncate";
import type { MaterialAsset } from "@buxo/domain/material-asset";

export interface MaterialSnapshot {
  materialSnapshotTextRef: string | null;
  materialSnapshotInfo: { truncated: boolean; droppedTokens: number } | null;
}

export function buildMaterialSnapshot(materials: MaterialAsset[]): MaterialSnapshot {
  const combinedText = materials
    .filter((m) => m.status === "ready")
    .map((m) => m.digestedTextRef)
    .join("\n\n---\n\n");
  const truncateResult = truncateMaterial(combinedText);
  return {
    materialSnapshotTextRef: combinedText.length > 0 ? truncateResult.text : null,
    materialSnapshotInfo: combinedText.length > 0 ? { truncated: truncateResult.truncated, droppedTokens: truncateResult.droppedTokens } : null,
  };
}
