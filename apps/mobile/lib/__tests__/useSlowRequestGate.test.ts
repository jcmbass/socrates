/**
 * Tests for lib/useSlowRequestGate.ts — tests the pure logic (threshold
 * constant). The hook itself is a thin wrapper around useEffect + setTimeout
 * and is exercised by the integration test in the courses screen.
 */
import { describe, expect, it } from "vitest";

import { GATE_THRESHOLD_MS } from "../useSlowRequestGate";

describe("GATE_THRESHOLD_MS", () => {
  it("is 1500ms (1.5 seconds)", () => {
    expect(GATE_THRESHOLD_MS).toBe(1_500);
  });
});
