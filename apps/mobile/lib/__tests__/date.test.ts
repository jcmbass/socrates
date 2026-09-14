import { describe, expect, it } from "vitest";

import { formatShortDate } from "../date";

describe("formatShortDate", () => {
  it("formats dd/mm/yyyy with zero padding", () => {
    // Local-time rendering of a midday UTC timestamp is date-stable for
    // any timezone within ±11h.
    expect(formatShortDate("2026-07-05T12:00:00.000Z")).toBe("05/07/2026");
  });

  it("returns empty string for garbage", () => {
    expect(formatShortDate("not-a-date")).toBe("");
  });

  // A1 — locale parametrization. Default stays es (dd/mm/yyyy) so every
  // pre-migration caller renders exactly as before.
  it("defaults to es order (dd/mm/yyyy) when no locale is passed", () => {
    expect(formatShortDate("2026-07-05T12:00:00.000Z")).toBe("05/07/2026");
    expect(formatShortDate("2026-07-05T12:00:00.000Z", "es")).toBe("05/07/2026");
  });

  it("formats mm/dd/yyyy for en", () => {
    expect(formatShortDate("2026-07-05T12:00:00.000Z", "en")).toBe("07/05/2026");
  });

  it("returns empty string for garbage in every locale", () => {
    expect(formatShortDate("not-a-date", "en")).toBe("");
  });
});
