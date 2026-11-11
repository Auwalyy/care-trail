'use client';

import { useEffect } from 'react';
import { listenForSignOut, refreshSession } from '@/services/api';
import { useSession } from './session-store';

const REFRESH_LEAD_MS = 60_000;

/**
 * Restores the session from the refresh cookie on load, refreshes the access token shortly before
 * it expires, and follows sign-outs from other tabs.
 */
export function SessionBootstrap() {
  const expiresAt = useSession((s) => s.accessTokenExpiresAt);

  useEffect(() => {
    void refreshSession();
    return listenForSignOut();
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    const delay = Math.max(5_000, expiresAt - Date.now() - REFRESH_LEAD_MS);
    const timer = setTimeout(() => void refreshSession(), delay);
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return null;
}
