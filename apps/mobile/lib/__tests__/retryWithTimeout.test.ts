/**
 * Tests for lib/retryWithTimeout.ts — pure logic, no react-native imports,
 * runs under vitest/node.
 */
import { describe, expect, it, vi } from "vitest";

import {
  COLD_START_TIMEOUT_MS,
  fetchWithColdStartRetry,
  fetchWithTimeout,
  isTimeoutError,
  timeoutSignal,
  WARM_TIMEOUT_MS,
  isRetrySafeMethod,
} from "../retryWithTimeout";

/**
 * Create a mock fetch that respects AbortSignal: if the signal is already
 * aborted, rejects immediately with the signal's reason. Otherwise resolves
 * after `delayMs` with a 200 response — unless the signal fires first, in
 * which case it rejects with the signal's reason.
 */
function signalAwareMockFetch(
  delayMs: number = 1_000_000,
): (url: string, init?: RequestInit) => Promise<Response> {
  return vi.fn().mockImplementation(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const onAbort = () => reject(signal!.reason);
        signal?.addEventListener("abort", onAbort, { once: true });
        setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(new Response("ok", { status: 200 }));
        }, delayMs);
      }),
  );
}

describe("timeoutSignal", () => {
  it("returns undefined for ms <= 0", () => {
    expect(timeoutSignal(0)).toBeUndefined();
    expect(timeoutSignal(-1)).toBeUndefined();
  });

  it("returns a signal that aborts after the given ms", async () => {
    const signal = timeoutSignal(10);
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(signal!.aborted).toBe(true);
    expect(signal!.reason).toBeInstanceOf(DOMException);
    expect((signal!.reason as DOMException).name).toBe("TimeoutError");
  });
});

describe("isTimeoutError", () => {
  it("returns true for DOMException TimeoutError", () => {
    expect(isTimeoutError(new DOMException("Timeout", "TimeoutError"))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isTimeoutError(new Error("network"))).toBe(false);
    expect(isTimeoutError(new DOMException("Abort", "AbortError"))).toBe(false);
    expect(isTimeoutError("string")).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});

describe("fetchWithTimeout", () => {
  it("resolves normally when the request completes in time", async () => {
    const mockFetch = signalAwareMockFetch(5);
    const response = await fetchWithTimeout(mockFetch, "http://example.com", {}, 1000);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("rejects with TimeoutError when the request exceeds the timeout", async () => {
    const mockFetch = signalAwareMockFetch(200);
    await expect(fetchWithTimeout(mockFetch, "http://example.com", {}, 10)).rejects.toThrowError(
      expect.objectContaining({ name: "TimeoutError" }),
    );
  });

  it("passes through non-timeout errors (network error)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchWithTimeout(mockFetch, "http://example.com", {}, 1000)).rejects.toThrow(TypeError);
  });

  it("respects the caller's AbortSignal", async () => {
    const controller = new AbortController();
    const mockFetch = signalAwareMockFetch(200);
    setTimeout(() => controller.abort(new DOMException("Aborted", "AbortError")), 5);
    await expect(
      fetchWithTimeout(mockFetch, "http://example.com", { signal: controller.signal }, 1000),
    ).rejects.toThrowError(
      expect.objectContaining({ name: "AbortError" }),
    );
  });

  it("bypasses timeout when timeoutMs <= 0", async () => {
    const mockFetch = signalAwareMockFetch(5);
    const response = await fetchWithTimeout(mockFetch, "http://example.com", {}, 0);
    expect(response.status).toBe(200);
  });
});

describe("fetchWithColdStartRetry", () => {
  it("resolves on the first attempt if it succeeds", async () => {
    const mockFetch = signalAwareMockFetch(5);
    const response = await fetchWithColdStartRetry(mockFetch, "http://example.com", {}, 1000);
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries once on timeout and resolves on the retry", async () => {
    let attempts = 0;
    const mockFetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          attempts++;
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          const onAbort = () => reject(signal!.reason);
          signal?.addEventListener("abort", onAbort, { once: true });

          if (attempts === 1) {
            // First attempt: never resolve (will time out)
            return;
          }
          // Second attempt: resolve quickly
          setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve(new Response("ok", { status: 200 }));
          }, 5);
        }),
    );
    const response = await fetchWithColdStartRetry<Response>(mockFetch, "http://example.com", {}, 10);
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("re-throws the timeout error if both attempts time out", async () => {
    const mockFetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          const onAbort = () => reject(signal!.reason);
          signal?.addEventListener("abort", onAbort, { once: true });
          // Never resolves — will time out
        }),
    );
    await expect(fetchWithColdStartRetry(mockFetch, "http://example.com", {}, 10)).rejects.toThrowError(
      expect.objectContaining({ name: "TimeoutError" }),
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on non-timeout errors", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchWithColdStartRetry(mockFetch, "http://example.com", {}, 1000)).rejects.toThrow(TypeError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on caller-initiated abort", async () => {
    const controller = new AbortController();
    const mockFetch = signalAwareMockFetch(200);
    setTimeout(() => controller.abort(new DOMException("Aborted", "AbortError")), 5);
    await expect(
      fetchWithColdStartRetry(mockFetch, "http://example.com", { signal: controller.signal }, 1000),
    ).rejects.toThrowError(
      expect.objectContaining({ name: "AbortError" }),
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("exports the expected default timeout constants", () => {
    expect(COLD_START_TIMEOUT_MS).toBe(180_000);
    expect(WARM_TIMEOUT_MS).toBe(30_000);
  });
});

describe("isRetrySafeMethod", () => {
  it("acepta métodos que no cambian estado", () => {
    expect(isRetrySafeMethod(undefined)).toBe(true); // default de fetch = GET
    expect(isRetrySafeMethod("GET")).toBe(true);
    expect(isRetrySafeMethod("get")).toBe(true);
    expect(isRetrySafeMethod("HEAD")).toBe(true);
  });

  it("rechaza todo lo que puede haber tenido efecto", () => {
    expect(isRetrySafeMethod("POST")).toBe(false);
    expect(isRetrySafeMethod("post")).toBe(false);
    expect(isRetrySafeMethod("PATCH")).toBe(false);
    expect(isRetrySafeMethod("PUT")).toBe(false);
    expect(isRetrySafeMethod("DELETE")).toBe(false);
  });
});

describe("fetchWithColdStartRetry — nunca repite un POST (bug del 2026-07-29)", () => {
  /**
   * El founder mandó un mensaje al tutor, se pasó el tiempo, y al volver
   * encontró su mensaje enviado, respondido Y repetido. El reintento
   * automático mandaba de nuevo un POST no idempotente.
   */
  it("NO reintenta un POST que se pasó de tiempo", async () => {
    const mockFetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          // nunca resuelve: siempre se pasa del tiempo
        }),
    );
    await expect(
      fetchWithColdStartRetry<Response>(mockFetch, "http://example.com/v1/sessions/s1/exchanges", { method: "POST" }, 10),
    ).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("sí reintenta un GET que se pasó de tiempo (arranque en frío de Render)", async () => {
    let attempts = 0;
    const mockFetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          attempts++;
          const signal = init?.signal;
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          if (attempts === 1) return;
          setTimeout(() => resolve(new Response("ok", { status: 200 })), 5);
        }),
    );
    const response = await fetchWithColdStartRetry<Response>(mockFetch, "http://example.com/v1/temario/x", { method: "GET" }, 10);
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
