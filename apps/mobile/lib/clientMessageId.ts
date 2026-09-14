/**
 * Client message ids for turn idempotency (beta-real 10).
 *
 * Invariant: the id is born when the student composes/sends a message and
 * MUST be reused on every retry of that same pending turn. A fresh id per
 * retry would defeat server-side dedupe entirely.
 */
export function createClientMessageId(nowMs: number = Date.now()): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${nowMs}-${Math.random().toString(36).slice(2, 10)}`;
  return `cm-${rand}`;
}

/**
 * Resolve the id to send with this attempt. Pass the still-pending id from a
 * previous failed attempt; pass null for a brand-new composition.
 */
export function resolveClientMessageId(pendingId: string | null): string {
  return pendingId ?? createClientMessageId();
}
