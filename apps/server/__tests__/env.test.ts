import { describe, expect, it } from "vitest";
import { readEnv } from "../src/env";

/**
 * TESTER_ENROLL_TOKEN/TESTER_ENROLL_EXPIRES_AT (2026-09-05): must be set
 * together or not at all — a token with no expiry would be a permanent
 * backdoor, exactly what this feature must never become.
 */
describe("readEnv: JWT_SECRET default is invalid outside dev", () => {
  it("rejects the documented default when BUXO_ENV is prod or staging", () => {
    expect(() => readEnv({ BUXO_ENV: "prod" })).toThrow(/JWT_SECRET/);
    expect(() => readEnv({ BUXO_ENV: "staging" })).toThrow(/JWT_SECRET/);
  });

  it("accepts a non-default JWT_SECRET in prod", () => {
    expect(() =>
      readEnv({ BUXO_ENV: "prod", JWT_SECRET: "a-long-random-value-not-the-default-32" }),
    ).not.toThrow();
  });

  it("still accepts the documented default in dev", () => {
    expect(() => readEnv({})).not.toThrow();
    expect(() => readEnv({ BUXO_ENV: "dev" })).not.toThrow();
  });
});

describe("readEnv: TESTER_ENROLL_TOKEN requires TESTER_ENROLL_EXPIRES_AT and vice versa", () => {
  it("boots fine with neither set (default: fully disabled)", () => {
    expect(() => readEnv({})).not.toThrow();
  });

  it("boots fine with both set", () => {
    expect(() =>
      readEnv({
        TESTER_ENROLL_TOKEN: "a-token-at-least-16-chars",
        TESTER_ENROLL_EXPIRES_AT: new Date(Date.now() + 1000).toISOString(),
      }),
    ).not.toThrow();
  });

  it("fails loud with only TESTER_ENROLL_TOKEN set", () => {
    expect(() => readEnv({ TESTER_ENROLL_TOKEN: "a-token-at-least-16-chars" })).toThrow();
  });

  it("fails loud with only TESTER_ENROLL_EXPIRES_AT set", () => {
    expect(() => readEnv({ TESTER_ENROLL_EXPIRES_AT: new Date(Date.now() + 1000).toISOString() })).toThrow();
  });
});
