import { describe, expect, it } from "vitest";
import { dailyPeriodKey, monthlyPeriodKey, nextDailyResetAt, nextMonthlyResetAt } from "../../src/quota/period";

describe("El Salvador (UTC-6, no DST) quota period math", () => {
  it("dailyPeriodKey: a UTC morning hour is still the PREVIOUS day in El Salvador", () => {
    // 2026-07-12T04:00:00Z is 2026-07-11T22:00:00 in El Salvador (UTC-6).
    expect(dailyPeriodKey(new Date("2026-07-12T04:00:00Z"))).toBe("2026-07-11");
  });

  it("dailyPeriodKey: a UTC afternoon hour matches the same El Salvador day", () => {
    // 2026-07-12T18:00:00Z is 2026-07-12T12:00:00 in El Salvador.
    expect(dailyPeriodKey(new Date("2026-07-12T18:00:00Z"))).toBe("2026-07-12");
  });

  it("dailyPeriodKey: exactly at the El Salvador midnight boundary (06:00 UTC) rolls to the new day", () => {
    expect(dailyPeriodKey(new Date("2026-07-12T06:00:00Z"))).toBe("2026-07-12");
    expect(dailyPeriodKey(new Date("2026-07-12T05:59:59.999Z"))).toBe("2026-07-11");
  });

  it("monthlyPeriodKey follows the same El Salvador-local rule at a month boundary", () => {
    // 2026-08-01T03:00:00Z is 2026-07-31T21:00:00 in El Salvador — still July.
    expect(monthlyPeriodKey(new Date("2026-08-01T03:00:00Z"))).toBe("2026-07");
    expect(monthlyPeriodKey(new Date("2026-08-01T06:00:00Z"))).toBe("2026-08");
  });

  it("nextDailyResetAt is always strictly in the future and lands on 06:00 UTC (El Salvador midnight)", () => {
    const now = new Date("2026-07-12T18:00:00Z");
    const reset = nextDailyResetAt(now);
    expect(new Date(reset).getTime()).toBeGreaterThan(now.getTime());
    expect(reset).toBe("2026-07-13T06:00:00.000Z");
  });

  it("nextMonthlyResetAt lands on the 1st of the next month at El Salvador midnight", () => {
    const now = new Date("2026-07-12T18:00:00Z");
    expect(nextMonthlyResetAt(now)).toBe("2026-08-01T06:00:00.000Z");
  });

  it("nextMonthlyResetAt handles December -> January year rollover", () => {
    const now = new Date("2026-12-15T18:00:00Z");
    expect(nextMonthlyResetAt(now)).toBe("2027-01-01T06:00:00.000Z");
  });
});
