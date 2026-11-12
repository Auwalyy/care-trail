import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startAutoSync } from '@/services/sync';
import { restoreSession, useSession } from '@/store/session';
import { restoreLanguage } from '@/utils/i18n';

/** Lock the app (PIN needed) after this long in the background — the phone may be shared. */
const LOCK_AFTER_MS = 5 * 60_000;

export default function RootLayout() {
  const phase = useSession((s) => s.phase);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    void restoreLanguage();
    void restoreSession();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current && Date.now() - backgroundedAt.current > LOCK_AFTER_MS) useSession.getState().lock();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (phase === 'unlocked') return startAutoSync();
  }, [phase]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f5f7fa' } }} />
    </SafeAreaProvider>
  );
}
