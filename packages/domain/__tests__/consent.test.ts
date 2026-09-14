import { describe, expect, it } from "vitest";
import { ConsentSchema, type Consent } from "../consent";

function makeConsent(overrides: Partial<Consent> = {}): Consent {
  return {
    id: "consent-1",
    userId: "user-1",
    type: "terms_13plus",
    status: "accepted",
    policyVersion: "2026-07-01",
    occurredAt: "2026-07-10T10:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("ConsentSchema", () => {
  it("accepts a well-formed accepted Consent", () => {
    expect(ConsentSchema.safeParse(makeConsent()).success).toBe(true);
  });

  it("accepts a withdrawn Consent", () => {
    expect(ConsentSchema.safeParse(makeConsent({ status: "withdrawn" })).success).toBe(true);
  });

  it("accepts the forward-modeled 'parental' type (O-13, not enabled in etapa 1 but a valid shape)", () => {
    expect(ConsentSchema.safeParse(makeConsent({ type: "parental" })).success).toBe(true);
  });

  it("rejects an unknown ConsentType", () => {
    expect(ConsentSchema.safeParse(makeConsent({ type: "guardian_sms" as never })).success).toBe(false);
  });

  it("rejects an empty policyVersion", () => {
    expect(ConsentSchema.safeParse(makeConsent({ policyVersion: "" })).success).toBe(false);
  });
});
