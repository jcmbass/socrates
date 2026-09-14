/** `Response.json()` is typed `Promise<unknown>` (undici-types, spec-accurate) — tests know their own response shapes. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
