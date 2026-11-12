import { ApiClient, ApiError, createCaretrailApi } from '@caretrail/api-client';
import { getRefreshToken, storeRefreshToken, useSession } from '@/store/session';
import { appConfig } from '@/utils/config';

let refreshing: Promise<boolean> | null = null;

/** Exchanges the stored refresh token for a new access token (rotates the refresh token). */
export function refreshAccessToken(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const token = await getRefreshToken();
      if (!token) return false;
      const res = await api.auth.refresh(token);
      if (res.refreshToken) await storeRefreshToken(res.refreshToken);
      useSession.getState().setAccessToken(res.accessToken);
      return true;
    } catch (err) {
      // Offline is fine (keep working locally); an invalid session needs a new online sign-in.
      if (err instanceof ApiError && !err.isTransient) useSession.getState().reset('signed_out');
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * API client for the CHW app. Rural networks are slow: allow longer than the web default before
 * treating a request as failed.
 */
export const apiClient = new ApiClient({
  baseUrl: appConfig.apiUrl,
  defaultTimeoutMs: 30_000,
  getAccessToken: () => useSession.getState().accessToken,
  onUnauthorized: () => refreshAccessToken(),
});

export const api = createCaretrailApi(apiClient);
