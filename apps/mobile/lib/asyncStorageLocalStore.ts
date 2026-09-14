/**
 * AsyncStorage-backed LocalStore (see localStore.ts for the interface and
 * the WP2-only intent: backend becomes truth in WP6/C3).
 *
 * Kept in its own module so nothing vitest touches imports
 * @react-native-async-storage — the unit suite runs under node with
 * InMemoryLocalStore; this binding is exercised by the `expo export`
 * bundling gate and, later, on-device.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  parsePersistedState,
  serializePersistedState,
  type LocalStore,
  type PersistedAppState,
} from "./localStore";

/** Versioned key: bump alongside PersistedAppState.blobVersion (v2 = F1/WP6 Part 2, auth-only). */
const STORAGE_KEY = "buxo/local-state/v2";

export class AsyncStorageLocalStore implements LocalStore {
  async load(): Promise<PersistedAppState | null> {
    const blob = await AsyncStorage.getItem(STORAGE_KEY);
    if (blob === null) return null;
    return parsePersistedState(blob);
  }

  async save(state: PersistedAppState): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, serializePersistedState(state));
  }

  async clear(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }
}
