/**
 * Public, build-time configuration. Only NEXT_PUBLIC_* values may be read here — they are inlined
 * into the browser bundle, so they must never contain secrets.
 */
export const publicEnv = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
} as const;
