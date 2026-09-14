/**
 * AsyncStorage persistence for guided recipe variant (D2-a).
 * Kept separate from guidedRecipe.ts so vitest never imports the native module.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { guidedVariantStorageKey } from "./guidedRecipe";

export async function readLastGuidedVariant(topicId: string): Promise<number | null> {
  const raw = await AsyncStorage.getItem(guidedVariantStorageKey(topicId));
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : null;
}

export async function writeLastGuidedVariant(topicId: string, variant: number): Promise<void> {
  await AsyncStorage.setItem(guidedVariantStorageKey(topicId), String(variant));
}
