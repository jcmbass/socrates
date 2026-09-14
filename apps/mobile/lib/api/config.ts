/**
 * apps/server base URL (F1/WP6 dev local, DF-5.2). Default assumes
 * `adb reverse tcp:3001 tcp:3001` (device/emulator loopback -> the dev
 * machine's server) — the preferred path per the WP6 mandate. Overridable
 * via `EXPO_PUBLIC_API_BASE_URL` (Expo's public-env-var convention, inlined
 * at bundle time) for the Android emulator (`http://10.0.2.2:3001`, which
 * does NOT share the host's localhost) or a LAN IP.
 */
export const API_BASE_URL: string = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
