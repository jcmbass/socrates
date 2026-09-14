/**
 * Uniform error shape — C-backend-plataforma.md §2.4: "Forma de error
 * uniforme: `{ error: string; code: string }`." Quota (§2.5) and safety
 * (§3) codes are reserved values (`quota_exceeded`, `safety_blocked`) so
 * clients can special-case them.
 */
import type { Context } from "hono";

export const ERROR_CODES = [
  "invalid_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "duplicate_turn",
  /** Same spirit as duplicate_turn: retry of an in-flight or finished material upload. */
  "duplicate_material",
  "quota_exceeded",
  "safety_blocked",
  "raster_page_too_large",
  "upstream_error",
  "internal_error",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  duplicate_turn: 409,
  duplicate_material: 409,
  quota_exceeded: 429,
  safety_blocked: 200, // handled in-band as a normal (blocked) reply, not an HTTP error — see routes/sessions.ts
  raster_page_too_large: 400,
  upstream_error: 502,
  internal_error: 500,
};

export function errorBody(code: ErrorCode, message: string): { error: string; code: ErrorCode } {
  return { error: message, code };
}

export function errorResponse(c: Context, code: ErrorCode, message: string, statusOverride?: number) {
  const status = statusOverride ?? STATUS_BY_CODE[code];
  return c.json(errorBody(code, message), status as 200 | 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502);
}
