import { describe, expect, it } from "vitest";
import { AuthIdentifierSchema, UserSchema, type User } from "../user";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
    schemaVersion: 1,
    displayName: "Estudiante Uno",
    authIdentifiers: [
      { type: "email", value: "student@example.com", verifiedAt: null, isPrimary: true },
    ],
    countryCode: "SV",
    preferredLanguageCode: "es",
    ageConfirmedAt: "2026-07-10T10:00:00.000Z",
    birthYear: null,
    currentCourseId: null,
    accountStatus: "active",
    deletedAt: null,
    accountKind: "student",
    onboardingCompletedAt: null,
    ...overrides,
  };
}

describe("UserSchema", () => {
  it("accepts a well-formed User", () => {
    expect(UserSchema.safeParse(makeUser()).success).toBe(true);
  });

  it("accepts internal_dev accounts (unbounded quota per §2.1)", () => {
    expect(UserSchema.safeParse(makeUser({ accountKind: "internal_dev" })).success).toBe(true);
  });

  it("rejects an invalid accountStatus", () => {
    const result = UserSchema.safeParse(makeUser({ accountStatus: "banned" as never }));
    expect(result.success).toBe(false);
  });

  it("rejects an empty displayName", () => {
    expect(UserSchema.safeParse(makeUser({ displayName: "" })).success).toBe(false);
  });

  it("rejects a countryCode that isn't 2 letters", () => {
    expect(UserSchema.safeParse(makeUser({ countryCode: "SLV" })).success).toBe(false);
  });

  it("rejects a non-ISO timestamp for ageConfirmedAt", () => {
    expect(UserSchema.safeParse(makeUser({ ageConfirmedAt: "not-a-date" })).success).toBe(false);
  });
});

describe("AuthIdentifierSchema", () => {
  it("accepts email/phone/external_oauth types", () => {
    for (const type of ["email", "phone", "external_oauth"] as const) {
      const result = AuthIdentifierSchema.safeParse({
        type,
        value: "x",
        verifiedAt: null,
        isPrimary: false,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown identifier type", () => {
    const result = AuthIdentifierSchema.safeParse({
      type: "fingerprint",
      value: "x",
      verifiedAt: null,
      isPrimary: false,
    });
    expect(result.success).toBe(false);
  });
});
