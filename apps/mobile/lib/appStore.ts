/**
 * The app's single store instance (AsyncStorage-backed) + the React hook
 * screens use. Split from store.ts so the unit tests can import the
 * factory with InMemoryLocalStore without pulling AsyncStorage (a native
 * module) into node.
 */
import { useStore } from "zustand";

import { AsyncStorageLocalStore } from "./asyncStorageLocalStore";
import { createAppStore, type AppStore } from "./store";

export const appStore = createAppStore(new AsyncStorageLocalStore());

/** Selector-subscribed read: `const user = useAppState((s) => s.user);` */
export function useAppState<T>(selector: (state: AppStore) => T): T {
  return useStore(appStore, selector);
}
