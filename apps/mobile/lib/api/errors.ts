/**
 * Client-side mirror of apps/server's uniform error shape
 * (`{error, code}` — C-backend §2.4, `apps/server/src/errors.ts`). Kept as
 * a plain string union (not imported from apps/server — apps/mobile has no
 * dependency on it) so this module stays RN-runtime-safe and independently
 * testable; the two lists are kept in sync by hand.
 */
export const API_ERROR_CODES = [
  "invalid_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "duplicate_turn",
  "duplicate_material",
  "quota_exceeded",
  "safety_blocked",
  "raster_page_too_large",
  "upstream_error",
  "internal_error",
  /** Client-only synthetic code: fetch/stream-read failure, no HTTP response at all (DF-5.2 mid-stream drop). */
  "network_error",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

function isKnownCode(code: unknown): code is ApiErrorCode {
  return typeof code === "string" && (API_ERROR_CODES as readonly string[]).includes(code);
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** null for network_error (no HTTP response was ever received). */
  readonly status: number | null;

  constructor(code: ApiErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }

  /** Best-effort mapping from a parsed `{error, code}` body — unknown codes degrade to "internal_error" rather than throwing on an unexpected server value. */
  static fromBody(body: unknown, status: number): ApiError {
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const code = isKnownCode(record.code) ? record.code : "internal_error";
    const message = typeof record.error === "string" ? record.error : `Request failed with status ${status}`;
    return new ApiError(code, message, status);
  }
}

export function isQuotaExceeded(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === "quota_exceeded";
}

export function isUnauthorized(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === "unauthorized";
}

export function isNetworkError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === "network_error";
}
