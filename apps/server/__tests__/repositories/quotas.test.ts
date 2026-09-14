/**
 * Tests for the PB5 migration 0003 and costUsdIncomplete bandera.
 *
 * Verifies:
 * 1. Migration 0003 applied: cost_usd_estimate nullable, cost_usd_incomplete exists.
 * 2. recordUsage with costUsd=null sets costUsdIncomplete=true.
 * 3. recordUsage with costUsd=number does NOT touch costUsdIncomplete.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../src/db/test-db";
import { createUser } from "../../src/repositories/users";
import { getOrCreateQuota, recordUsage } from "../../src/repositories/quotas";
import { sql, eq } from "drizzle-orm";
import { usageQuotas } from "../../src/db/schema";

describe("PB5 — migration 0003 (cost_usd_estimate nullable + cost_usd_incomplete)", () => {
  let testDb: TestDb;

  afterEach(async () => {
    await testDb?.close();
  });

  it("migration 0003 aplicada: cost_usd_estimate es nullable, cost_usd_incomplete existe", async () => {
    testDb = await createTestDb();
    // Verify by inserting a row with null cost_usd_estimate — would fail if NOT NULL
    const user = await createUser(testDb.db, {
      email: "migration-test@example.com",
      displayName: "Migration Test",
      ageConfirmedAt: new Date().toISOString(),
    });
    const quota = await getOrCreateQuota(testDb.db, user.id, "daily", {
      capTutorMessages: 10,
      capCostUsd: 5,
    });

    // Direct insert with null cost_usd_estimate to verify column is nullable
    await testDb.db.insert(usageQuotas).values({
      id: "test-null-cost-id",
      userId: user.id,
      period: "monthly",
      periodKey: "2026-07",
      tutorMessagesUsed: 0,
      assessorCallsUsed: 0,
      judgeCallsUsed: 0,
      ingestCloudCallsUsed: 0,
      costUsdEstimate: null,
      costUsdIncomplete: false,
      capTutorMessages: null,
      capCostUsd: null,
      resetAt: new Date().toISOString(),
      schemaVersion: 1,
    });

    // Read back and verify null was stored
    const [row] = await testDb.db
      .select()
      .from(usageQuotas)
      .where(eq(usageQuotas.id, "test-null-cost-id"))
      .limit(1);
    expect(row.costUsdEstimate).toBeNull();
    expect(row.costUsdIncomplete).toBe(false);
  });

  it("recordUsage con costUsd=null marca costUsdIncomplete=true", async () => {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, {
      email: "null-cost@example.com",
      displayName: "Null Cost",
      ageConfirmedAt: new Date().toISOString(),
    });
    const quota = await getOrCreateQuota(testDb.db, user.id, "daily", {
      capTutorMessages: 10,
      capCostUsd: 5,
    });

    // Record usage with null cost
    await recordUsage(testDb.db, quota.id, "tutor", null);

    // Read back and verify
    const [row] = await testDb.db
      .select()
      .from(usageQuotas)
      .where(sql`${usageQuotas.id} = ${quota.id}`)
      .limit(1);
    expect(row.costUsdIncomplete).toBe(true);
    expect(row.costUsdEstimate).toBe(0); // null cost doesn't change the estimate
  });

  it("recordUsage con costUsd numérico NO marca costUsdIncomplete", async () => {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, {
      email: "normal-cost@example.com",
      displayName: "Normal Cost",
      ageConfirmedAt: new Date().toISOString(),
    });
    const quota = await getOrCreateQuota(testDb.db, user.id, "daily", {
      capTutorMessages: 10,
      capCostUsd: 5,
    });

    // Record usage with a real cost
    await recordUsage(testDb.db, quota.id, "assessor", 0.05);

    // Read back and verify
    const [row] = await testDb.db
      .select()
      .from(usageQuotas)
      .where(sql`${usageQuotas.id} = ${quota.id}`)
      .limit(1);
    expect(row.costUsdIncomplete).toBe(false);
    expect(row.costUsdEstimate).toBeCloseTo(0.05, 5);
  });

  it("recordUsage con costUsd=null en assessor también marca la bandera", async () => {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, {
      email: "null-assessor@example.com",
      displayName: "Null Assessor",
      ageConfirmedAt: new Date().toISOString(),
    });
    const quota = await getOrCreateQuota(testDb.db, user.id, "daily", {
      capTutorMessages: 10,
      capCostUsd: 5,
    });

    await recordUsage(testDb.db, quota.id, "assessor", null);

    const [row] = await testDb.db
      .select()
      .from(usageQuotas)
      .where(sql`${usageQuotas.id} = ${quota.id}`)
      .limit(1);
    expect(row.costUsdIncomplete).toBe(true);
  });

  it("mezcla de costos: null y numérico — la bandera queda true", async () => {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, {
      email: "mixed-cost@example.com",
      displayName: "Mixed Cost",
      ageConfirmedAt: new Date().toISOString(),
    });
    const quota = await getOrCreateQuota(testDb.db, user.id, "daily", {
      capTutorMessages: 10,
      capCostUsd: 5,
    });

    // First a real cost, then a null cost
    await recordUsage(testDb.db, quota.id, "tutor", 0.1);
    await recordUsage(testDb.db, quota.id, "assessor", null);

    const [row] = await testDb.db
      .select()
      .from(usageQuotas)
      .where(sql`${usageQuotas.id} = ${quota.id}`)
      .limit(1);
    expect(row.costUsdIncomplete).toBe(true);
    expect(row.costUsdEstimate).toBeCloseTo(0.1, 5);
  });

  it("guided_items records cost without pretending to be a tutor message", async () => {
    testDb = await createTestDb();
    const user = await createUser(testDb.db, {
      email: "guided-cost@example.com",
      displayName: "Guided Cost",
      ageConfirmedAt: new Date().toISOString(),
    });
    const quota = await getOrCreateQuota(testDb.db, user.id, "daily", {
      capTutorMessages: 10,
      capCostUsd: 5,
    });

    await recordUsage(testDb.db, quota.id, "guided_items", 0.07);
    const [row] = await testDb.db
      .select()
      .from(usageQuotas)
      .where(sql`${usageQuotas.id} = ${quota.id}`)
      .limit(1);
    expect(row.tutorMessagesUsed).toBe(0);
    expect(row.costUsdEstimate).toBeCloseTo(0.07, 5);
    expect(row.costUsdIncomplete).toBe(false);
  });
});
