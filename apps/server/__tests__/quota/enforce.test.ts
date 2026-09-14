import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { checkTutorQuota, recordQuotaUsage, type QuotaConfig } from "../../src/quota/enforce";
import { createUser } from "../../src/repositories/users";

const CONFIG: QuotaConfig = {
  dailyTutorMessages: 2,
  monthlyTutorMessages: 10,
  capCostUsd: 1,
  dailyIngestCloudPages: 5,
  monthlyIngestCloudPages: 20,
};

describe("checkTutorQuota/recordQuotaUsage — under/at/over limit (§2.5)", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  async function newUser() {
    testDb = await createTestDb();
    return createUser(testDb.db, { email: "quota-unit@example.com", displayName: "Ana", ageConfirmedAt: new Date().toISOString() });
  }

  it("under the cap: ok, and returns the (daily, monthly) quota rows to record against", async () => {
    const user = await newUser();
    const result = await checkTutorQuota(testDb.db, user.id, "student", CONFIG);
    expect(result.ok).toBe(true);
  });

  it("at the cap: the NEXT check (after recording up to the cap) is blocked", async () => {
    const user = await newUser();
    const first = await checkTutorQuota(testDb.db, user.id, "student", CONFIG);
    if (!first.ok) throw new Error("expected ok");
    await recordQuotaUsage(testDb.db, first.quotas, "tutor", 0.1);
    await recordQuotaUsage(testDb.db, first.quotas, "tutor", 0.1); // now at cap (2/2)

    const second = await checkTutorQuota(testDb.db, user.id, "student", CONFIG);
    expect(second).toEqual({ ok: false, reason: "daily_messages" });
  });

  it("over the cost cap (even under the message-count cap): blocked with reason cost_cap", async () => {
    const user = await newUser();
    const first = await checkTutorQuota(testDb.db, user.id, "student", CONFIG);
    if (!first.ok) throw new Error("expected ok");
    await recordQuotaUsage(testDb.db, first.quotas, "tutor", 1.5); // exceeds capCostUsd=1 in a single call

    const second = await checkTutorQuota(testDb.db, user.id, "student", CONFIG);
    expect(second).toEqual({ ok: false, reason: "cost_cap" });
  });

  it("assessor/judge calls count toward the USD cap even though they have no per-message cap of their own (§2.5)", async () => {
    const user = await newUser();
    const first = await checkTutorQuota(testDb.db, user.id, "student", CONFIG);
    if (!first.ok) throw new Error("expected ok");
    await recordQuotaUsage(testDb.db, first.quotas, "assessor", 0.6);
    await recordQuotaUsage(testDb.db, first.quotas, "judge", 0.6); // cumulative 1.2 > cap 1

    const second = await checkTutorQuota(testDb.db, user.id, "student", CONFIG);
    expect(second).toEqual({ ok: false, reason: "cost_cap" });
  });

  it("internal_dev accounts get null caps — never blocked", async () => {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, {
      email: "dev@example.com",
      displayName: "Dev",
      ageConfirmedAt: new Date().toISOString(),
      accountKind: "internal_dev",
    });
    const result = await checkTutorQuota(testDb.db, user.id, "internal_dev", CONFIG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quotas.daily.capTutorMessages).toBeNull();
      expect(result.quotas.daily.capCostUsd).toBeNull();
    }
  });
});
