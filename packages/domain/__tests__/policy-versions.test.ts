import { describe, expect, it } from "vitest";
import {
  CURRENT_POLICY_VERSIONS,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "../policy-versions";

describe("CURRENT_POLICY_VERSIONS (Play 0.3.0 legales)", () => {
  it("pins the published 2026-09 versions", () => {
    expect(CURRENT_TERMS_VERSION).toBe("terms-2026-09-v2");
    expect(CURRENT_PRIVACY_VERSION).toBe("privacy-2026-09-v4");
    expect(CURRENT_POLICY_VERSIONS).toEqual({
      terms_13plus: "terms-2026-09-v2",
      privacy_policy: "privacy-2026-09-v4",
    });
  });
});
