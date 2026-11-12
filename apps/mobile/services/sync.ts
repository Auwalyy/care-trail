import { AppState } from 'react-native';
import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';
import Constants from 'expo-constants';
import { create } from 'zustand';
import { HttpTransport, SyncEngine, type SyncReport } from '@caretrail/sync-core';
import { SqliteStore } from '@/database/sqlite-store';
import { deviceId, useSession } from '@/store/session';
import { apiClient, refreshAccessToken } from './api';

interface SyncState {
  running: boolean;
  lastReport: SyncReport | null;
  lastSuccessAt: string | null;
}
export const useSyncState = create<SyncState>(() => ({ running: false, lastReport: null, lastSuccessAt: null }));

let engine: SyncEngine | null = null;
async function getEngine() {
  engine ??= new SyncEngine(new SqliteStore(), new HttpTransport(apiClient), {
    deviceId: await deviceId(),
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
  });
  return engine;
}

async function online(): Promise<boolean> {
  const s = await getNetworkStateAsync();
  return s.isConnected !== false && s.isInternetReachable !== false;
}

/** Runs one controlled sync if signed in and online. Safe to call any time (calls are coalesced). */
export async function syncNow(): Promise<SyncReport | null> {
  const session = useSession.getState();
  if (session.phase !== 'unlocked' || !(await online())) return null;
  if (!session.accessToken && !(await refreshAccessToken())) return null;
  useSyncState.setState({ running: true });
  try {
    const report = await (await getEngine()).sync();
    useSyncState.setState((s) => ({ lastReport: report, lastSuccessAt: report.pulled ? report.finishedAt : s.lastSuccessAt }));
    if (report.outcome === 'auth_required') useSession.getState().reset('signed_out');
    return report;
  } finally {
    useSyncState.setState({ running: false });
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null;
/** Called after every local write: sync shortly after, batching quick successive edits. */
export function scheduleSync(delayMs = 3_000) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), delayMs);
}

/** Automatic triggers: connectivity regained, app back in the foreground, and every 5 minutes. */
export function startAutoSync(): () => void {
  const net = addNetworkStateListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) scheduleSync(1_000);
  });
  const app = AppState.addEventListener('change', (state) => {
    if (state === 'active') scheduleSync(500);
  });
  const timer = setInterval(() => void syncNow(), 5 * 60_000);
  scheduleSync(500);
  return () => {
    net.remove();
    app.remove();
    clearInterval(timer);
  };
}
