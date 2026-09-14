import { describe, expect, it } from "vitest";
import { UsageQuotaSchema, type UsageQuota } from "../usage-quota";

function makeQuota(overrides: Partial<UsageQuota> = {}): UsageQuota {
  return {
    id: "quota-1",
    userId: "user-1",
    period: "daily",
    periodKey: "2026-07-12",
    tutorMessagesUsed: 10,
    assessorCallsUsed: 3,
    judgeCallsUsed: 1,
    ingestCloudCallsUsed: 0,
    costUsdEstimate: 0.12,
    costUsdIncomplete: false,
    capTutorMessages: 50,
    capCostUsd: 1,
    resetAt: "2026-07-13T00:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("UsageQuotaSchema", () => {
  it("accepts a well-formed daily quota", () => {
    expect(UsageQuotaSchema.safeParse(makeQuota()).success).toBe(true);
  });

  it("accepts a monthly period with a YYYY-MM periodKey", () => {
    expect(UsageQuotaSchema.safeParse(makeQuota({ period: "monthly", periodKey: "2026-07" })).success).toBe(true);
  });

  it("accepts null caps (unlimited, e.g. accountKind: internal_dev)", () => {
    expect(UsageQuotaSchema.safeParse(makeQuota({ capTutorMessages: null, capCostUsd: null })).success).toBe(true);
  });

  it("rejects a negative tutorMessagesUsed", () => {
    expect(UsageQuotaSchema.safeParse(makeQuota({ tutorMessagesUsed: -1 })).success).toBe(false);
  });

  it("rejects an invalid period", () => {
    expect(UsageQuotaSchema.safeParse(makeQuota({ period: "weekly" as never })).success).toBe(false);
  });
});
