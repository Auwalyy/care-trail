import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { dashboardCounts } from '@/database/repo';
import { useConnectivity } from '@/hooks/use-connectivity';
import { syncNow, useSyncState } from '@/services/sync';
import { useLocalQuery } from '@/store/data-version';
import { useT } from '@/utils/i18n';

/** Always-visible online/offline + sync state, so CHWs know what has reached the server. */
export function SyncBanner() {
  const t = useT();
  const router = useRouter();
  const net = useConnectivity();
  const running = useSyncState((s) => s.running);
  const counts = useLocalQuery(dashboardCounts);
  const unsynced = counts.data?.unsynced ?? 0;
  const attention = counts.data?.needsAttention ?? 0;
  const online = net === 'online';
  return (
    <Pressable onPress={() => router.push('/sync')} accessibilityRole="button" className={`flex-row items-center gap-3 rounded-xl px-4 py-3 ${attention ? 'bg-danger-50' : unsynced ? 'bg-warning-50' : 'bg-success-50'}`}>
      <View className={`h-3 w-3 rounded-full ${online ? 'bg-success-700' : 'bg-ink-subtle'}`} />
      <View className="flex-1">
        <Text className="text-base font-semibold text-ink">{online ? t('online') : t('offline')}</Text>
        <Text className="text-sm text-ink-muted">
          {running ? t('syncing') : attention ? t('needsAttention', { n: attention }) : unsynced ? t('waitingToSync', { n: unsynced }) : t('allSynced')}
        </Text>
      </View>
      {online && !running ? (
        <Pressable onPress={() => void syncNow()} accessibilityRole="button" className="min-h-12 justify-center rounded-lg bg-surface px-3">
          <Text className="font-semibold text-brand-700">{t('syncNow')}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}
