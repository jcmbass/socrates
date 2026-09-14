/**
 * Root layout: loads brand fonts and hydrates the local store once, then
 * mounts the router Stack. Theme follows the OS scheme, dark-first
 * (DESIGN.md §2; D2 §4.3 dark/light from day one); header/content colors
 * come from the token set so every screen inherits them without
 * per-screen styling.
 */
import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from "@expo-google-fonts/jetbrains-mono";

import { appStore, useAppState } from "../lib/appStore";
import { LocaleProvider } from "../i18n/react";
import { useTheme } from "../theme/useTheme";
import { typography } from "../theme/tokens";

export default function RootLayout() {
  const theme = useTheme();
  const hydrated = useAppState((s) => s.hydrated);
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    void appStore.getState().hydrate();
  }, []);

  return (
    // Device e13 M1 (founder-reported): every screen's `useSafeAreaInsets()`
    // was returning zeros on-device (arrow behind the status bar, header
    // colliding with the clock) because nothing wrapped the app in a
    // `SafeAreaProvider` — the hook falls back to zeroed insets with no
    // provider above it. Wraps BOTH branches (pre-hydration view included)
    // so insets are available from the very first frame, not just once the
    // Stack mounts.
    <SafeAreaProvider>
      <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
      <LocaleProvider>
        {hydrated && fontsLoaded ? (
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.colors.surface },
              headerTintColor: theme.colors.foreground,
              headerTitleStyle: {
                color: theme.colors.foreground,
                fontWeight: typography.weights.semibold,
                fontFamily: typography.fontFamily.semibold,
              },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: theme.colors.surface },
            }}
          />
        ) : (
          // Pre-hydration/pre-font frame: bare surface, no spinner —
          // hydration is a single AsyncStorage read and the Google Fonts
          // package bundles the .ttf locally (no network fetch), so both
          // resolve well under a spinner's first frame.
          <View style={{ flex: 1, backgroundColor: theme.colors.surface }} />
        )}
      </LocaleProvider>
    </SafeAreaProvider>
  );
}
