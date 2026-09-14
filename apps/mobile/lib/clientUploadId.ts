/**
 * Client upload ids for material-ingest idempotency (same spirit as
 * `clientMessageId` / beta-real 10 for turns).
 *
 * Invariant: the id is born when the student picks a file and MUST be
 * reused on every retry of that same pending upload. A fresh id per retry
 * would defeat server-side dedupe and double-charge vision.
 */
export function createClientUploadId(nowMs: number = Date.now()): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${nowMs}-${Math.random().toString(36).slice(2, 10)}`;
  return `cu-${rand}`;
}

/**
 * Resolve the id to send with this attempt. Pass the still-pending id from a
 * previous failed attempt; pass null for a brand-new pick.
 */
export function resolveClientUploadId(pendingId: string | null): string {
  return pendingId ?? createClientUploadId();
}
