/** Central id/timestamp helpers — every repository uses these, never a raw `crypto.randomUUID()` inline. */
export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
