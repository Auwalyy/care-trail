/**
 * Public app configuration. EXPO_PUBLIC_* variables are inlined at build time — never secrets.
 * On an Android emulator the host machine is reachable at 10.0.2.2; on a physical device use the
 * machine's LAN IP (set EXPO_PUBLIC_API_URL in apps/mobile/.env).
 */
export const appConfig = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000/api/v1',
} as const;
