import { create } from 'zustand';
import type { AuthenticatedUser, LoginResponse, Permission } from '@caretrail/shared-types';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionState {
  status: SessionStatus;
  /** Kept in memory only — never persisted to localStorage/sessionStorage. */
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  user: AuthenticatedUser | null;
  /** Set when the session could not be restored because the API was unreachable. */
  restoreError: string | null;
  setSession: (session: LoginResponse) => void;
  setUser: (user: AuthenticatedUser) => void;
  clear: (restoreError?: string | null) => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  accessToken: null,
  accessTokenExpiresAt: null,
  user: null,
  restoreError: null,
  setSession: (s) =>
    set({
      status: 'authenticated',
      accessToken: s.accessToken,
      accessTokenExpiresAt: Date.parse(s.accessTokenExpiresAt),
      user: s.user,
      restoreError: null,
    }),
  setUser: (user) => set({ user }),
  clear: (restoreError = null) =>
    set({ status: 'anonymous', accessToken: null, accessTokenExpiresAt: null, user: null, restoreError }),
}));

export function useCan(permission: Permission): boolean {
  return useSession((s) => s.user?.permissions.includes(permission) ?? false);
}
