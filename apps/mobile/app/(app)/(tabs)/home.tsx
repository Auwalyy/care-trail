import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SyncBanner } from '@/components/sync-banner';
import { Button, Screen, Title } from '@/components/ui';
import { dashboardCounts } from '@/database/repo';
import { useSyncState } from '@/services/sync';
import { useLocalQuery } from '@/store/data-version';
import { useSession } from '@/store/session';
import { useT } from '@/utils/i18n';

function Stat({ label, value, tone, onPress }: { label: string; value: number | undefined; tone?: 'warn'; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="min-h-24 flex-1 basis-[46%] justify-between rounded-xl border border-border bg-surface p-4 active:bg-canvas">
      <Text className="text-base text-ink-muted">{label}</Text>
      <Text className={`text-3xl font-bold ${tone === 'warn' && value ? 'text-danger-700' : 'text-brand-900'}`}>{value ?? '–'}</Text>
    </Pressable>
  );
}

export default function Home() {
  const t = useT();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const counts = useLocalQuery(dashboardCounts).data;
  const lastSync = useSyncState((s) => s.lastSuccessAt);

  return (
    <Screen>
      <Title sub={`${t('lastSync')}: ${lastSync ? new Date(lastSync).toLocaleString() : t('never')}`}>{user?.fullName.split(' ')[0] ?? t('appName')}</Title>
      <SyncBanner />
      <View className="flex-row flex-wrap gap-3">
        <Stat label={t('assignedPatients')} value={counts?.patients} onPress={() => router.push('/patients')} />
        <Stat label={t('newRegistrations')} value={counts?.newRegistrations} onPress={() => router.push('/sync')} />
        <Stat label={t('openReferrals')} value={counts?.openReferrals} onPress={() => router.push('/referrals')} />
        <Stat label={t('overdueAppointments')} value={counts?.overdueAppointments} tone="warn" onPress={() => router.push('/tasks')} />
        <Stat label={t('openTasks')} value={counts?.openTasks} tone="warn" onPress={() => router.push('/tasks')} />
      </View>
      <Button label={t('registerPatient')} onPress={() => router.push('/register')} />
      <View className="flex-row gap-3">
        <View className="flex-1"><Button label={counts?.unreadMessages ? `${t('messages')} (${counts.unreadMessages})` : t('messages')} variant="secondary" onPress={() => router.push('/messages')} /></View>
        <View className="flex-1"><Button label={t('learn')} variant="secondary" onPress={() => router.push('/learn')} /></View>
      </View>
    </Screen>
  );
}
