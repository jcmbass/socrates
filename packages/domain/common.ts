/**
 * Shared zod primitives, defined once and reused by every entity schema in
 * this package — B3 §1 "Convenciones": "Todo id es `string` (UUID v4 o
 * equivalente...)"; "Todo timestamp es un `string` ISO-8601 UTC (mismo
 * criterio que la alfa — ordenable lexicográficamente, ver
 * `lib/session.ts`)". Not a B3 entity itself; pure schema plumbing.
 */
import { z } from "zod";

/** Any entity/value-object id: non-empty string (B3 §1 — UUID v4 "o equivalente"). */
export const idSchema = z.string().min(1);

/** ISO-8601 UTC timestamp, `Z`-suffixed (matches `Date.prototype.toISOString()`, the alfa's convention). */
export const isoTimestampSchema = z.iso.datetime();

/** `schemaVersion`: monotonic per-entity structural version counter (B3 §5.1). Starts at 1, never 0 or negative. */
export const schemaVersionSchema = z.number().int().min(1);
