import { describe, expect, it, vi } from "vitest";
import { runChainWithFailover, defaultClassifyError } from "../failover";
import { InMemoryTelemetrySink } from "../telemetry";
import { ModelsConfigError } from "../errors";

const TUTOR_CHAIN = [
  { providerId: "anthropic", modelId: "claude-haiku-4-5" },
  { providerId: "anthropic", modelId: "claude-sonnet-5" },
];

describe("defaultClassifyError", () => {
  it("classifies rate-limit/429 as http_429", () => {
    expect(defaultClassifyError(new Error("429 rate_limit_error"))).toBe("http_429");
  });
  it("classifies a 5xx message as http_5xx", () => {
    expect(defaultClassifyError(new Error("received 503 Service Unavailable"))).toBe("http_5xx");
  });
  it("classifies a timeout as timeout", () => {
    expect(defaultClassifyError(new Error("request timed out after 30000ms"))).toBe("timeout");
  });
  it("classifies AbortError / TimeoutError as timeout (per-attempt abort)", () => {
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    expect(defaultClassifyError(abort)).toBe("timeout");
    const timedOut = new Error("The operation was aborted due to timeout");
    timedOut.name = "TimeoutError";
    expect(defaultClassifyError(timedOut)).toBe("timeout");
  });
  it("classifies an auth error as auth_config_error", () => {
    expect(defaultClassifyError(new Error("401 Unauthorized: invalid api key"))).toBe("auth_config_error");
  });
  it("classifies a network error as network_error", () => {
    expect(defaultClassifyError(new Error("fetch failed: ECONNRESET"))).toBe("network_error");
  });
  it("classifies a schema/structured-output error as structured_output_invalid", () => {
    expect(defaultClassifyError(new Error("AI_NoObjectGeneratedError: could not parse JSON matching schema"))).toBe(
      "structured_output_invalid",
    );
  });
  it("classifies an unrecognized error as unknown_error (still advances the chain, never silently propagates)", () => {
    expect(defaultClassifyError(new Error("something bizarre happened"))).toBe("unknown_error");
  });
  it("classifies a ModelsConfigError as non_retryable (never masked)", () => {
    expect(defaultClassifyError(new ModelsConfigError("bad config"))).toBe("non_retryable");
  });
});

describe("runChainWithFailover", () => {
  it("returns ok:true from the first candidate on success, with no telemetry", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const attempt = vi.fn().mockResolvedValue("ok-result");
    const outcome = await runChainWithFailover({
      chain: TUTOR_CHAIN,
      task: "tutor",
      environment: "dev",
      telemetry,
      sameModelRetries: 0,
      attempt,
    });
    expect(outcome).toMatchObject({ ok: true, result: "ok-result", servedBy: TUTOR_CHAIN[0], attemptIndex: 0 });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(telemetry.events).toEqual([]);
  });

  it("MANDATORY: advances to the second candidate and records a fallback event when the first throws a network error", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"))
      .mockResolvedValueOnce("served-by-sonnet");

    const outcome = await runChainWithFailover({
      chain: TUTOR_CHAIN,
      task: "tutor",
      environment: "dev",
      telemetry,
      sameModelRetries: 0,
      attempt,
    });

    expect(outcome).toEqual({ ok: true, result: "served-by-sonnet", servedBy: TUTOR_CHAIN[1], attemptIndex: 1 });
    expect(attempt).toHaveBeenCalledTimes(2);

    const fallbackEvents = telemetry.events.filter((e) => e.type === "fallback");
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0]).toMatchObject({
      type: "fallback",
      task: "tutor",
      environment: "dev",
      from: TUTOR_CHAIN[0],
      to: TUTOR_CHAIN[1],
      reason: "network_error",
      attemptIndex: 0,
    });
  });

  it("retries the SAME model sameModelRetries times before advancing (§1.3.1 structured-output retry)", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("could not parse JSON matching schema"))
      .mockResolvedValueOnce("second-try-same-model");

    const outcome = await runChainWithFailover({
      chain: TUTOR_CHAIN,
      task: "assessor",
      environment: "dev",
      telemetry,
      sameModelRetries: 1,
      attempt,
    });

    expect(outcome).toEqual({
      ok: true,
      result: "second-try-same-model",
      servedBy: TUTOR_CHAIN[0],
      attemptIndex: 0,
    });
    expect(attempt).toHaveBeenCalledTimes(2);
    // Both attempts were against the SAME chain candidate, so no fallback event.
    expect(telemetry.events.filter((e) => e.type === "fallback")).toHaveLength(0);
  });

  it("advances to the next candidate once sameModelRetries is exhausted on the first", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("could not parse JSON matching schema"))
      .mockRejectedValueOnce(new Error("could not parse JSON matching schema"))
      .mockResolvedValueOnce("served-by-second-candidate");

    const outcome = await runChainWithFailover({
      chain: TUTOR_CHAIN,
      task: "assessor",
      environment: "dev",
      telemetry,
      sameModelRetries: 1,
      attempt,
    });

    expect(outcome).toMatchObject({ ok: true, servedBy: TUTOR_CHAIN[1] });
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(telemetry.events.filter((e) => e.type === "fallback")).toHaveLength(1);
  });

  it("returns ok:false with the last error once the whole chain is exhausted", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const lastError = new Error("503 from sonnet too");
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unreachable"))
      .mockRejectedValueOnce(lastError);

    const outcome = await runChainWithFailover({
      chain: TUTOR_CHAIN,
      task: "tutor",
      environment: "dev",
      telemetry,
      sameModelRetries: 0,
      attempt,
    });

    expect(outcome).toEqual({ ok: false, lastError });
    expect(telemetry.events.filter((e) => e.type === "fallback")).toHaveLength(2);
    // Chain exhausted: the second (last) fallback event's `to` is null.
    expect(telemetry.events[1]).toMatchObject({ to: null });
  });

  it("re-throws a ModelsConfigError immediately, never masking it as a fallback", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const configError = new ModelsConfigError("some config is broken");
    const attempt = vi.fn().mockRejectedValue(configError);

    await expect(
      runChainWithFailover({
        chain: TUTOR_CHAIN,
        task: "tutor",
        environment: "dev",
        telemetry,
        sameModelRetries: 0,
        attempt,
      }),
    ).rejects.toBe(configError);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(telemetry.events).toEqual([]);
  });

  it("skips a candidate that lacks a required capability and records it as an 'unsupported_capability' fallback", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const attempt = vi.fn().mockResolvedValue("served-by-sonnet");

    const outcome = await runChainWithFailover({
      chain: TUTOR_CHAIN,
      task: "assessor",
      environment: "dev",
      telemetry,
      sameModelRetries: 0,
      skip: (capabilities) => capabilities.modelId === "claude-haiku-4-5",
      attempt,
    });

    expect(outcome).toMatchObject({ ok: true, servedBy: TUTOR_CHAIN[1] });
    expect(attempt).toHaveBeenCalledTimes(1); // the skipped candidate was never attempted
    expect(telemetry.events).toEqual([
      expect.objectContaining({ type: "fallback", reason: "unsupported_capability", from: TUTOR_CHAIN[0] }),
    ]);
  });
});
