export type KeyboardInsetPlatform = "android" | "ios" | "windows" | "macos" | "web";

/**
 * Padding owned by a composer. When an ancestor already applies the safe
 * area, return only the keyboard delta so the navigation inset is not
 * counted twice.
 */
export function resolveKeyboardBottomPadding(
  platform: KeyboardInsetPlatform,
  keyboardHeight: number,
  insetsBottom: number,
  baseInsetAlreadyApplied = false,
): number {
  "worklet";
  const fullInset = platform === "android" ? Math.max(keyboardHeight, insetsBottom) : insetsBottom;
  return Math.max(0, fullInset - (baseInsetAlreadyApplied ? insetsBottom : 0));
}
