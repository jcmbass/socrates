/**
 * Regresión: enviar un mensaje fallaba con "Revisá tu conexión" cuando la
 * conexión estaba perfecta — el chat colapsaba CUALQUIER error del servidor
 * en ese único texto. Ver `lib/turnErrorCopy.ts`.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../api/errors";
import { t } from "../../i18n/es";
import { turnErrorCopy, turnErrorIsRetryable } from "../turnErrorCopy";

describe("turnErrorCopy", () => {
  it("una caída del proveedor del tutor NO culpa a la conexión", () => {
    const copy = turnErrorCopy(new ApiError("upstream_error", "Tutor chain exhausted", 502));
    // Puede mencionar la conexión, pero solo para DESCARTARLA.
    expect(copy).not.toMatch(/Revisá tu conexión/i);
    expect(copy).toMatch(/Socrates no está disponible/i);
    expect(copy).toMatch(/No es tu conexión/i);
  });

  it("solo un fallo de red real habla de la conexión", () => {
    const copy = turnErrorCopy(new ApiError("network_error", "Network request failed", null));
    expect(copy).toMatch(/conexión/i);
  });

  it("un error del servidor dice que el mensaje sigue ahí", () => {
    expect(turnErrorCopy(new ApiError("internal_error", "boom", 500))).toMatch(/reintentar/i);
  });

  it("una sesión cerrada explica qué hacer y no ofrece reintento", () => {
    const err = new ApiError("conflict", "Session is not active", 409);
    expect(turnErrorCopy(err)).toMatch(/ya se cerró/i);
    expect(turnErrorIsRetryable(err)).toBe(false);
  });

  it("lo que no es ApiError cae en el mensaje genérico", () => {
    expect(turnErrorCopy(new TypeError("undefined is not a function"))).toBe(t.common.genericError);
  });

  it("ningún código conocido produce texto vacío", () => {
    const codes = ["network_error", "upstream_error", "internal_error", "conflict", "not_found", "forbidden"] as const;
    for (const code of codes) {
      expect(turnErrorCopy(new ApiError(code, "x", 500)).length, `code=${code}`).toBeGreaterThan(0);
    }
  });
});

describe("duplicate_turn (beta-real 10)", () => {
  it("pide esperar, no reenviar — reenviar es justo lo que duplica", () => {
    const copy = turnErrorCopy(new ApiError("duplicate_turn", "already in flight", 409));
    expect(copy).toMatch(/ya se está enviando/i);
    expect(copy).not.toMatch(/Revisá tu conexión/i);
  });
});
