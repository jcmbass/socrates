import { describe, expect, it } from "vitest";
import { t } from "../../i18n/es";
import {
  fuentesIngestErrorCopy,
  materialIngestErrorCopy,
  reconcileDigestFailedError,
  skillTreeIngestErrorCopy,
} from "../ingestErrorCopy";

describe("ingestErrorCopy (beta-real 07 B.3)", () => {
  it("names the daily ingest quota and when it renews", () => {
    expect(materialIngestErrorCopy("quota", "Ingest quota exceeded (daily_ingest_pages)")).toMatch(/diario/i);
    expect(materialIngestErrorCopy("quota", "Ingest quota exceeded (daily_ingest_pages)")).toMatch(/mañana/i);
  });

  it("names the monthly ingest quota", () => {
    expect(materialIngestErrorCopy("quota", "Ingest quota exceeded (monthly_ingest_pages)")).toMatch(/mensual/i);
  });

  it("explains a large PDF with no usable index (server too_many_pages)", () => {
    expect(materialIngestErrorCopy("too_many_pages")).toMatch(/índice/i);
    expect(materialIngestErrorCopy("too_many_pages")).toMatch(/largo/i);
  });

  it("surfaces raster_too_large distinctly from unknown", () => {
    expect(skillTreeIngestErrorCopy("raster_too_large")).toMatch(/grande/i);
    expect(skillTreeIngestErrorCopy("generate_failed")).toMatch(/temario/i);
  });

  it("surfaces digestFailed copy for a server failed-digest row (no reason field on the payload)", () => {
    expect(fuentesIngestErrorCopy("digest_failed")).toBe(t.fuentes.errors.digestFailed);
    expect(fuentesIngestErrorCopy("digest_failed")).not.toBe(t.fuentes.errors.unknown);
    expect(fuentesIngestErrorCopy("digest_failed")).not.toBe(t.fuentes.errors.network);
    expect(reconcileDigestFailedError()).toEqual({
      kind: "digest_failed",
      message: t.fuentes.errors.digestFailed,
    });
    // Other surfaces have no digestFailed string — fall back to unknown, do not invent.
    expect(materialIngestErrorCopy("digest_failed")).toBe(t.materialIngest.errors.unknown);
  });
});
