import { ApiClient } from '@caretrail/api-client';
import { publicEnv } from '@/lib/env';

/**
 * Shared API client for the browser. Session handling (access token in memory, httpOnly refresh
 * cookie, onUnauthorized → refresh) is wired in Phase 2.
 */
export const api = new ApiClient({
  baseUrl: publicEnv.apiUrl,
  credentials: 'include',
});
