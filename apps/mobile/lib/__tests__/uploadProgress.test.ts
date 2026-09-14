/**
 * Regression: the bar hit 100% and the UI stayed on "Subiendo… 100%" for the
 * entire server-side processing, because RN never fires `upload.onload`.
 * See `lib/api/uploadProgress.ts`.
 */
import { describe, expect, it } from "vitest";
import { isUploadEffectivelyDone, uploadProgressUpdate } from "../api/uploadProgress";

describe("uploadProgressUpdate", () => {
  it("marks finished when the last byte leaves — the only signal RN gives us", () => {
    expect(uploadProgressUpdate(180_000, 180_000)).toEqual({ ratio: 1, finished: true });
  });

  it("is not finished mid-flight", () => {
    expect(uploadProgressUpdate(90_000, 180_000)).toEqual({ ratio: 0.5, finished: false });
  });

  it("clamps a ratio over 1 but still reports finished", () => {
    expect(uploadProgressUpdate(200_000, 180_000)).toEqual({ ratio: 1, finished: true });
  });

  it("returns null when there is nothing measurable to draw", () => {
    expect(uploadProgressUpdate(0, 0)).toBeNull();
    expect(uploadProgressUpdate(10, Number.NaN)).toBeNull();
    expect(uploadProgressUpdate(Number.NaN, 100)).toBeNull();
  });

  it("a zero-byte start is measurable, not finished", () => {
    expect(uploadProgressUpdate(0, 180_000)).toEqual({ ratio: 0, finished: false });
  });
});

describe("isUploadEffectivelyDone — the UI guarantee", () => {
  it("a full bar counts as done even without the final event", () => {
    expect(isUploadEffectivelyDone(1)).toBe(true);
    expect(isUploadEffectivelyDone(0.9995)).toBe(true);
  });

  it("mid-flight is not done", () => {
    expect(isUploadEffectivelyDone(0.5)).toBe(false);
    expect(isUploadEffectivelyDone(0)).toBe(false);
    expect(isUploadEffectivelyDone(null)).toBe(false);
  });
});
