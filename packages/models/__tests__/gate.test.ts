import { describe, expect, it } from "vitest";
import { isServableForTask } from "../gate";
import { TASK_KINDS, ENVIRONMENTS } from "../task";

describe("isServableForTask — gate enforcement covers EVERY task (vision doc principio 7, architect's ruling 2026-07-14)", () => {
  it("a validated row is always servable, in any environment/task/flag combination", () => {
    for (const task of TASK_KINDS) {
      for (const environment of ENVIRONMENTS) {
        expect(isServableForTask({ gateStatus: "validated" }, task, environment, false)).toBe(true);
        expect(isServableForTask({ gateStatus: "validated" }, task, environment, true)).toBe(true);
      }
    }
  });

  it("a pending_gate row is blocked for EVERY task in prod (no task is exempt — an ungated judge decalibrates the instrument; an ungated safety classifier is unacceptable)", () => {
    for (const task of TASK_KINDS) {
      expect(isServableForTask({ gateStatus: "pending_gate" }, task, "prod", false)).toBe(false);
    }
  });

  it("a pending_gate row is blocked for EVERY task in staging (the gate SUITE calls candidates directly, not through resolveChain — no staging exemption needed)", () => {
    for (const task of TASK_KINDS) {
      expect(isServableForTask({ gateStatus: "pending_gate" }, task, "staging", false)).toBe(false);
    }
  });

  it("a pending_gate row is blocked for EVERY task in dev WITHOUT the explicit flag (opt-in only)", () => {
    for (const task of TASK_KINDS) {
      expect(isServableForTask({ gateStatus: "pending_gate" }, task, "dev", false)).toBe(false);
    }
  });

  it("a pending_gate row IS servable for every task in dev WITH the explicit flag", () => {
    for (const task of TASK_KINDS) {
      expect(isServableForTask({ gateStatus: "pending_gate" }, task, "dev", true)).toBe(true);
    }
  });

  it("the flag has no effect outside dev (still blocked in staging/prod even if somehow true)", () => {
    for (const task of TASK_KINDS) {
      expect(isServableForTask({ gateStatus: "pending_gate" }, task, "staging", true)).toBe(false);
      expect(isServableForTask({ gateStatus: "pending_gate" }, task, "prod", true)).toBe(false);
    }
  });
});
