/**
 * App state — F1/WP6 Part 2: shrunk to an AUTH store. WP2's zustand store
 * held courses/subjects/sessions/exchanges locally (no backend existed
 * yet); apps/server (C3) is now the source of truth for all of that (see
 * lib/api/client.ts) — screens fetch it directly and hold it in their own
 * component state, refetching on mount (C3 "sesiones retomables": the
 * server, not a local cache, decides what's resumable). This store's only
 * remaining job is the one thing that genuinely needs to survive a cold
 * start without a network round-trip: whether the student is logged in.
 *
 * Persistence: unchanged pattern from WP2 (whole-state save through the
 * injected LocalStore, awaited so "returned" implies "persisted") — just a
 * much smaller state.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { AuthSession } from "./api/types";
import { EMPTY_STATE, type LocalStore, type PersistedAppState } from "./localStore";

export interface AppState extends PersistedAppState {
  /** True once hydrate() resolved (with or without stored state). */
  hydrated: boolean;
}

export interface AppActions {
  hydrate(): Promise<void>;
  /** Called once POST /v1/auth/verify succeeds — persists the bearer session (F1/WP6 "resume after app restart"). */
  completeLogin(session: AuthSession): Promise<void>;
  /** Clears the local auth session. Does NOT call the server (no DELETE /v1/auth/session endpoint exists in WP5's contract) — a bearer JWT just expires on its own TTL. */
  logout(): Promise<void>;
}

export type AppStore = AppState & AppActions;

function snapshot(state: AppState): PersistedAppState {
  return { blobVersion: 2, auth: state.auth };
}

export function createAppStore(local: LocalStore): StoreApi<AppStore> {
  return createStore<AppStore>()((set, get) => {
    async function persist(): Promise<void> {
      await local.save(snapshot(get()));
    }

    return {
      ...EMPTY_STATE,
      hydrated: false,

      async hydrate() {
        const stored = await local.load();
        set({ ...(stored ?? EMPTY_STATE), hydrated: true });
      },

      async completeLogin(session) {
        set({ auth: session });
        await persist();
      },

      async logout() {
        await local.clear();
        set({ ...EMPTY_STATE, hydrated: true });
      },
    };
  });
}
