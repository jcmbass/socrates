/**
 * MaterialAsset -> MaterialEvent mapping — F2 WQ3 parte C1, the DB-backed
 * half of the WQ2 acceptance-6 gap closure (see `@buxo/domain/
 * study-session`'s `MaterialEvent` docblock and `routes/sessions.ts`'s
 * former "DEVIATION #2" note, now resolved). Every route that attaches a
 * `MaterialAsset` to a `StudySession` (session creation with initial
 * materials, `POST /:id/materials` mid-session) builds its `MaterialEvent`
 * through `toMaterialEvent` below, so `kind`/`source` derivation stays in
 * exactly one place.
 */
import type { MaterialAsset } from "@buxo/domain/material-asset";
import type { MaterialEvent } from "@buxo/domain/study-session";

/**
 * `MaterialEvent.kind` mirrors the harness alfa's vocabulary
 * (`@buxo/core/transcript`'s `MaterialEvent`, paste/txt/pdf) — it has no
 * "photo" member. DEVIATION (documented, conservative call per this wave's
 * "no expandas alcance" rule): a `MaterialAsset` with `kind: "photo"` maps
 * to `"txt"` here, the closest "single non-paginated raw upload" bucket.
 * No attach flow in this codebase produces a "photo" MaterialAsset today —
 * `apps/mobile` only ever uploads a pdf-subset or pastes text
 * (`routes/materials.ts`'s module doc: image-ingest is still out of scope,
 * C4) — so this branch is unreached in practice; flagged for whoever
 * eventually builds that path to reconsider (extend the domain enum, most
 * likely, rather than keep mapping through "txt").
 */
export function materialEventKindFor(material: MaterialAsset): MaterialEvent["kind"] {
  if (material.kind === "photo") return "txt";
  return material.kind;
}

/**
 * Display name for the inline transcript marker (`apps/mobile`'s "Guía
 * añadida: {source}"). The original filename when there is one; a fixed
 * label for pasted text, which never has a filename
 * (`routes/materials.ts`'s paste path always persists `originalFilename:
 * null`) — same convention the harness's `MaterialInput.tsx` uses
 * (`source: "Texto pegado"` for its own paste entries). This app has no
 * i18n layer server-side (nor does the harness) — the whole product is
 * Spanish-only today, same as `safety/templates.ts`'s hardcoded copy.
 */
export function materialEventSourceFor(material: MaterialAsset): string {
  return material.originalFilename ?? "Texto pegado";
}

export function toMaterialEvent(material: MaterialAsset, action: MaterialEvent["action"], timestamp: string): MaterialEvent {
  return {
    timestamp,
    materialAssetId: material.id,
    source: materialEventSourceFor(material),
    kind: materialEventKindFor(material),
    action,
  };
}
