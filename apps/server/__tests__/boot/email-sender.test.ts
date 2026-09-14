/**
 * BE3 — EMAIL_SENDER fail-loud at readEnv (same pattern as BUXO_FAKE_MODELS).
 */
import { describe, expect, it } from "vitest";
import { readEnv } from "../../src/env";

const BASE = {
  JWT_SECRET: "test-only-secret-at-least-32-characters-long",
};

describe("EMAIL_SENDER — readEnv fail-loud guard", () => {
  it("throws when EMAIL_SENDER=resend and RESEND_API_KEY is missing", () => {
    expect(() =>
      readEnv({ ...process.env, ...BASE, EMAIL_SENDER: "resend" }),
    ).toThrow(/EMAIL_SENDER=resend requiere RESEND_API_KEY/);
  });

  it("throws when EMAIL_SENDER=resend and RESEND_API_KEY is empty/whitespace", () => {
    expect(() =>
      readEnv({ ...process.env, ...BASE, EMAIL_SENDER: "resend", RESEND_API_KEY: "" }),
    ).toThrow(/EMAIL_SENDER=resend requiere RESEND_API_KEY/);

    expect(() =>
      readEnv({ ...process.env, ...BASE, EMAIL_SENDER: "resend", RESEND_API_KEY: "   " }),
    ).toThrow(/EMAIL_SENDER=resend requiere RESEND_API_KEY/);
  });

  it("does NOT throw when EMAIL_SENDER=resend with a non-empty key", () => {
    const env = readEnv({
      ...process.env,
      ...BASE,
      EMAIL_SENDER: "resend",
      RESEND_API_KEY: "re_test_key_not_real",
    });
    expect(env.EMAIL_SENDER).toBe("resend");
    expect(env.RESEND_API_KEY).toBe("re_test_key_not_real");
  });

  it("defaults EMAIL_SENDER to console (dev behaviour unchanged)", () => {
    const env = readEnv({ ...process.env, ...BASE });
    expect(env.EMAIL_SENDER).toBe("console");
    expect(env.EMAIL_FROM).toBe("Socrates <onboarding@resend.dev>");
  });
});
