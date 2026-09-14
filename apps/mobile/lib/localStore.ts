/**
 * LocalStore — F1/WP6 Part 2: now that apps/server (C3, C-backend) is the
 * source of truth for courses/subjects/sessions/exchanges (see
 * lib/api/client.ts), this store's ONLY remaining job is the resilience the
 * WP2 module doc already predicted: "this layer then degrades to, at most,
 * a local draft/cache" — here it holds exactly the auth session
 * ({userId, email, displayName, token}), so a restarted app can resume
 * logged-in (F1/WP6 "resume after app restart") without re-doing the
 * magic-link flow. Everything else (courses, subjects, sessions,
 * exchanges) is fetched live from the server on each screen; there is no
 * local cache of it, and no builder mints its ids anymore.
 *
 * Design unchanged from WP2: one small JSON document (whole-state
 * save/load) behind the `LocalStore` interface. AsyncStorage is the real
 * backend (asyncStorageLocalStore.ts); `InMemoryLocalStore` backs unit
 * tests. `parsePersistedState` validates the blob and returns null on ANY
 * corruption rather than crash — losing a cached auth session just means
 * one extra login, never a broken app.
 */
import { z } from "zod";
import type { AuthSession } from "./api/types";

export interface PersistedAppState {
  /** Version of THIS blob's layout. Bumped from WP2's `1` (full local entity cache) to `2` (auth-only) — a WP2-era blob is dropped, not migrated (WP2 was never released). */
  blobVersion: 2;
  auth: AuthSession | null;
}

export const EMPTY_STATE: PersistedAppState = {
  blobVersion: 2,
  auth: null,
};

const AuthSessionSchema: z.ZodType<AuthSession> = z.object({
  userId: z.string().min(1),
  email: z.string().min(1),
  displayName: z.string(),
  token: z.string().min(1),
});

const PersistedAppStateSchema: z.ZodType<PersistedAppState> = z.object({
  blobVersion: z.literal(2),
  auth: AuthSessionSchema.nullable(),
});

/** null on invalid JSON or invalid shape — never throws. */
export function parsePersistedState(json: string): PersistedAppState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const result = PersistedAppStateSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function serializePersistedState(state: PersistedAppState): string {
  return JSON.stringify(state);
}

export interface LocalStore {
  /** null when nothing (or nothing valid) is stored. */
  load(): Promise<PersistedAppState | null>;
  save(state: PersistedAppState): Promise<void>;
  clear(): Promise<void>;
}

/** Test/dev double. Serializes on save so tests cover the round-trip. */
export class InMemoryLocalStore implements LocalStore {
  private blob: string | null = null;

  load(): Promise<PersistedAppState | null> {
    return Promise.resolve(this.blob === null ? null : parsePersistedState(this.blob));
  }

  save(state: PersistedAppState): Promise<void> {
    this.blob = serializePersistedState(state);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.blob = null;
    return Promise.resolve();
  }
}
