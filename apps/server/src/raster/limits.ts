/**
 * Server-side rasterization limits — C-backend-plataforma.md §2.5-style
 * "cap duro" pattern (hard cutoffs, not soft nudges), applied to the F2 WQ1
 * raster endpoint per the plan's explicit instruction ("Límites de
 * tamaño/página ... pick sane values and flag them for architect review").
 *
 * beta-real 07 (`docs/plan-beta-real/07-ingesta-escala-y-feedback.md`):
 * fixed `DEFAULT_RASTER_SCALE = 2` rejected panoramic slides (1376×768 at
 * 2× ≈ 4.2M px > `MAX_PIXELS_PER_PAGE`) and wasted tokens on large-type
 * pages. Adaptive scale targets a pixel budget + DPI floor instead.
 *
 * FLAGGED FOR ARCHITECT REVIEW — budget/floor numbers are first-pass
 * (plan §5: tune with a real-PDF run). Rationale:
 *
 * - `MAX_UPLOAD_PDF_BYTES` mirrors `lib/ingest/limits.ts`'s `MAX_PDF_BYTES`
 *   (32MB) — same ceiling, kept in sync by hand.
 * - `MAX_PAGES_PER_REQUEST` (20): bounds total request latency/memory.
 * - `MAX_PIXELS_PER_PAGE` (4M): hard canvas-memory ceiling. Only pages that
 *   exceed this even at scale 1 are rejected (`RasterPageTooLargeError`).
 * - `TARGET_PIXELS_PER_PAGE` (1.2M): preferred render budget — a US Letter
 *   page at ~110 DPI is ~1.17M px. Measured (infra/modal/deepinfra_gate.py,
 *   25 real pages): 150 DPI-equivalent (~1.5M) → Spanish median recall
 *   0.982 / precision 1.000 / bank cost US$0.0166; 110 DPI (~1.2M) →
 *   recall 0.968 / precision 0.995 / bank cost US$0.0127 (both PASS).
 *   Fewer pixels cut CPU/raster work AND vision input tokens (~23% cost).
 * - `MIN_RASTER_DPI` (110): OCR floor. Prefer spending more pixels than
 *   returning an illegible raster when the budget alone would undershoot.
 *   Measured interaction with TARGET=1.2M (`computeAdaptiveScale`):
 *   - US Letter / A4: target scale still slightly ABOVE the floor
 *     (~113 DPI / ~1.20M px) → floor NOT applied; budget binds.
 *   - 16:9 slides (1376×768): budget alone undershoots (~77 DPI) → floor
 *     STILL raises to 110 DPI (~2.47M px). Floor is NOT irrelevant.
 * - `RASTER_TIMEOUT_MS` (20_000 per page): generous relative to measured
 *   render times; worst-case request bound is
 *   `MAX_PAGES_PER_REQUEST * RASTER_TIMEOUT_MS`.
 */
export const MAX_UPLOAD_PDF_BYTES = 32 * 1024 * 1024;
export const MAX_PAGES_PER_REQUEST = 20;
export const MAX_PIXELS_PER_PAGE = 4_000_000;
export const RASTER_TIMEOUT_MS = 20_000;

/** Preferred rendered area per page (adaptive scale objective). */
export const TARGET_PIXELS_PER_PAGE = 1_200_000;

/**
 * Minimum DPI for OCR legibility. PDF user space is 72 pt/inch, so
 * `scale = dpi / 72`. Prefer this floor over the pixel budget when they
 * conflict (still clamped by `MAX_PIXELS_PER_PAGE`).
 */
export const MIN_RASTER_DPI = 110;

/** PDF user-space points per inch (ISO 32000). */
export const PDF_POINTS_PER_INCH = 72;

/**
 * Historical fixed scale (harness `DEFAULT_RASTER_SCALE`). Kept for
 * callers that pass an explicit `scale`; the adaptive path no longer
 * uses this as the default objective.
 */
export const DEFAULT_RASTER_SCALE = 2;
