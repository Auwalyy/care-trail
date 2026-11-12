import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import type { AuthenticatedUser, LoginResponse } from '@caretrail/shared-types';
import { wipeLocalData } from '@/database/db';

/**
 * CHW session (spec §6F "offline login"):
 *  - the first sign-in must be online; the refresh token and user profile are kept in SecureStore
 *    (Android Keystore), the access token only in memory;
 *  - the CHW then sets a PIN that unlocks the app offline, within the programme's offline grace
 *    period (`offlineSessionGraceDays`) since the last successful online authentication;
 *  - 5 wrong PINs require an online sign-in again.
 */
const K = {
  refresh: 'caretrail.refresh',
  user: 'caretrail.user',
  pin: 'caretrail.pin',
  lastOnline: 'caretrail.lastOnlineAuth',
  pinFailures: 'caretrail.pinFailures',
  deviceId: 'caretrail.deviceId',
} as const;
const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const MAX_PIN_ATTEMPTS = 5;
const DEFAULT_GRACE_DAYS = 14;

type Phase = 'loading' | 'signed_out' | 'needs_pin_setup' | 'locked' | 'unlocked';

interface SessionState {
  phase: Phase;
  user: AuthenticatedUser | null;
  accessToken: string | null;
  setOnlineSession: (s: LoginResponse) => Promise<void>;
  setAccessToken: (token: string) => void;
  markUnlocked: () => void;
  lock: () => void;
  reset: (phase: Phase) => void;
}

export const useSession = create<SessionState>((set) => ({
  phase: 'loading',
  user: null,
  accessToken: null,
  setOnlineSession: async (s) => {
    if (s.refreshToken) await SecureStore.setItemAsync(K.refresh, s.refreshToken, opts);
    await SecureStore.setItemAsync(K.user, JSON.stringify(s.user), opts);
    await SecureStore.setItemAsync(K.lastOnline, new Date().toISOString(), opts);
    await SecureStore.deleteItemAsync(K.pinFailures);
    const hasPin = Boolean(await SecureStore.getItemAsync(K.pin));
    set({ user: s.user, accessToken: s.accessToken, phase: hasPin ? 'unlocked' : 'needs_pin_setup' });
  },
  setAccessToken: (accessToken) => set({ accessToken }),
  markUnlocked: () => set({ phase: 'unlocked' }),
  lock: () => set((s) => (s.phase === 'unlocked' ? { phase: 'locked', accessToken: null } : s)),
  reset: (phase) => set({ phase, user: null, accessToken: null }),
}));

export async function getRefreshToken() {
  return SecureStore.getItemAsync(K.refresh);
}
export async function storeRefreshToken(token: string) {
  await SecureStore.setItemAsync(K.refresh, token, opts);
  await SecureStore.setItemAsync(K.lastOnline, new Date().toISOString(), opts);
}

/** Stable per-installation id, reported with each sync. */
export async function deviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(K.deviceId);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(K.deviceId, id, opts);
  return id;
}

/** Restores the saved session on app start: locked (PIN needed) or signed out. */
export async function restoreSession() {
  const [userJson, refresh, pin] = await Promise.all([SecureStore.getItemAsync(K.user), SecureStore.getItemAsync(K.refresh), SecureStore.getItemAsync(K.pin)]);
  if (!userJson || !refresh) return useSession.getState().reset('signed_out');
  const user = JSON.parse(userJson) as AuthenticatedUser;
  useSession.setState({ user, phase: pin ? 'locked' : 'needs_pin_setup' });
}

async function hashPin(pin: string, salt: string) {
  // 10k rounds of SHA-256: slows offline guessing; the attempt limit is the main protection.
  let h = `${salt}:${pin}`;
  for (let i = 0; i < 10_000; i++) h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, h);
  return h;
}

export async function setPin(pin: string) {
  const salt = Crypto.randomUUID();
  await SecureStore.setItemAsync(K.pin, JSON.stringify({ salt, hash: await hashPin(pin, salt) }), opts);
  useSession.getState().markUnlocked();
}

export type UnlockResult = { ok: true } | { ok: false; reason: 'wrong_pin' | 'too_many_attempts' | 'grace_expired'; attemptsLeft?: number };

export async function unlockWithPin(pin: string, graceDays = DEFAULT_GRACE_DAYS): Promise<UnlockResult> {
  const stored = await SecureStore.getItemAsync(K.pin);
  if (!stored) return { ok: false, reason: 'too_many_attempts' };
  const lastOnline = await SecureStore.getItemAsync(K.lastOnline);
  if (!lastOnline || Date.now() - Date.parse(lastOnline) > graceDays * 86_400_000) return { ok: false, reason: 'grace_expired' };
  const { salt, hash } = JSON.parse(stored) as { salt: string; hash: string };
  if ((await hashPin(pin, salt)) === hash) {
    await SecureStore.deleteItemAsync(K.pinFailures);
    useSession.getState().markUnlocked();
    return { ok: true };
  }
  const failures = Number((await SecureStore.getItemAsync(K.pinFailures)) ?? '0') + 1;
  if (failures >= MAX_PIN_ATTEMPTS) {
    await SecureStore.deleteItemAsync(K.pin);
    await SecureStore.deleteItemAsync(K.pinFailures);
    return { ok: false, reason: 'too_many_attempts' };
  }
  await SecureStore.setItemAsync(K.pinFailures, String(failures), opts);
  return { ok: false, reason: 'wrong_pin', attemptsLeft: MAX_PIN_ATTEMPTS - failures };
}

/** Signs out and removes everything from the phone, including unsynced work (the UI warns first). */
export async function signOutAndWipe() {
  for (const key of Object.values(K)) if (key !== K.deviceId) await SecureStore.deleteItemAsync(key);
  await wipeLocalData();
  useSession.getState().reset('signed_out');
}
