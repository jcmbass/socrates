import { describe, expect, it } from "vitest";
import { MigrationRecordSchema, type MigrationRecord } from "../migration-record";

function makeRecord(overrides: Partial<MigrationRecord> = {}): MigrationRecord {
  return {
    id: "migration-1",
    entityType: "StudySession",
    fromVersion: 1,
    toVersion: 2,
    appliedAt: "2026-07-10T10:00:00.000Z",
    appliedBy: "lazy_on_read",
    affectedCount: null,
    ...overrides,
  };
}

describe("MigrationRecordSchema", () => {
  it("accepts a well-formed lazy-on-read record with unknown affectedCount", () => {
    expect(MigrationRecordSchema.safeParse(makeRecord()).success).toBe(true);
  });

  it("accepts a backfill_job record with a known affectedCount", () => {
    const result = MigrationRecordSchema.safeParse(makeRecord({ appliedBy: "backfill_job", affectedCount: 412 }));
    expect(result.success).toBe(true);
  });

  it("rejects an invalid appliedBy", () => {
    expect(MigrationRecordSchema.safeParse(makeRecord({ appliedBy: "automatic" as never })).success).toBe(false);
  });

  it("has no schemaVersion field (B3 §2.13 — this entity describes migrations of OTHER entities' schemas)", () => {
    const parsed = MigrationRecordSchema.parse(makeRecord());
    expect(parsed).not.toHaveProperty("schemaVersion");
  });
});
