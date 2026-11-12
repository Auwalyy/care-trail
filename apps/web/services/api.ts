import { ApiClient, ApiError, createCareApi, createCaretrailApi } from '@caretrail/api-client';
import { useSession } from '@/features/auth/session-store';
import { publicEnv } from '@/lib/env';

/**
 * Browser API client. The access token is read from the in-memory session store; on a 401 the
 * client refreshes once (via the httpOnly refresh cookie) and retries the request.
 */
export const apiClient = new ApiClient({
  baseUrl: publicEnv.apiUrl,
  credentials: 'include',
  getAccessToken: () => useSession.getState().accessToken,
  onUnauthorized: () => refreshSession(),
});

export const api = { ...createCaretrailApi(apiClient), ...createCareApi(apiClient) };

const AUTH_CHANNEL = 'caretrail-auth';
let inflight: Promise<boolean> | null = null;

/**
 * Refreshes the session at most once at a time — across tabs too (Web Locks API), because the
 * refresh token rotates and two tabs racing would otherwise trip reuse detection.
 */
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    const run = async (): Promise<boolean> => {
      try {
        useSession.getState().setSession(await api.auth.refresh());
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.isTransient) {
          // Keep an existing session; only report failure if we had none.
          if (useSession.getState().status !== 'authenticated') {
            useSession.getState().clear('The CARETRAIL server could not be reached. Check your connection and try again.');
          }
          return false;
        }
        useSession.getState().clear();
        return false;
      }
    };
    return typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('caretrail-refresh', run)
      : run();
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function signOut(allDevices = false): Promise<void> {
  try {
    await api.auth.logout({ allDevices });
  } finally {
    useSession.getState().clear();
    broadcast('signed-out');
  }
}

function broadcast(message: 'signed-out') {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(AUTH_CHANNEL);
  ch.postMessage(message);
  ch.close();
}

/** Signs this tab out when another tab signs out. Returns an unsubscribe function. */
export function listenForSignOut(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(AUTH_CHANNEL);
  ch.onmessage = (e) => {
    if (e.data === 'signed-out') useSession.getState().clear();
  };
  return () => ch.close();
}
