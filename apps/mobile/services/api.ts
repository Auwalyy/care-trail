import { ApiClient } from '@caretrail/api-client';
import { appConfig } from '@/utils/config';

/**
 * API client for the CHW app. Token storage (SecureStore) and refresh are added in Phase 7;
 * all patient data access goes through the offline sync engine in Phase 8.
 */
export const api = new ApiClient({
  baseUrl: appConfig.apiUrl,
  // Rural networks are slow: allow longer than the web default before treating as offline.
  defaultTimeoutMs: 30_000,
});
