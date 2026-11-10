import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { HealthStatus } from '@caretrail/shared-types';
import { StatusRow } from '@/components/status-row';
import { useConnectivity } from '@/hooks/use-connectivity';
import { api } from '@/services/api';

type ServerState =
  | { kind: 'checking' }
  | { kind: 'ok'; health: HealthStatus; checkedAt: Date }
  | { kind: 'unreachable'; message: string; checkedAt: Date };

/**
 * Phase 1 foundation screen: shows device connectivity and live API readiness so the build can
 * be verified on a real device. Replaced by the CHW dashboard tabs in Phase 7.
 */
export default function FoundationScreen() {
  const connectivity = useConnectivity();
  const [server, setServer] = useState<ServerState>({ kind: 'checking' });

  const check = useCallback(async () => {
    setServer({ kind: 'checking' });
    try {
      const health = await api.readiness();
      setServer({ kind: 'ok', health, checkedAt: new Date() });
    } catch (err) {
      setServer({
        kind: 'unreachable',
        message: err instanceof Error ? err.message : 'Unknown error',
        checkedAt: new Date(),
      });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check, connectivity]);

  const db = server.kind === 'ok' ? server.health.checks?.mongodb : undefined;

  return (
    <SafeAreaView className="flex-1 bg-canvas">
      <ScrollView contentContainerClassName="p-5 gap-6">
        <View>
          <Text className="text-sm font-semibold uppercase tracking-wide text-teal-700">
            No Patient Left Behind
          </Text>
          <Text className="mt-1 text-3xl font-bold text-brand-900">CARETRAIL</Text>
          <Text className="mt-2 text-base text-ink-muted">Community Health Worker app</Text>
        </View>

        <View className="rounded-xl border border-border bg-surface px-4 py-2">
          <StatusRow
            label="This phone"
            value={connectivity === 'online' ? 'Online' : connectivity === 'offline' ? 'Offline' : 'Checking…'}
            tone={connectivity === 'online' ? 'good' : connectivity === 'offline' ? 'bad' : 'neutral'}
          />
          <StatusRow
            label="CARETRAIL server"
            value={
              server.kind === 'checking'
                ? 'Checking…'
                : server.kind === 'unreachable'
                  ? 'Not reachable'
                  : server.health.status === 'ok'
                    ? 'Ready'
                    : 'Not ready'
            }
            tone={server.kind === 'checking' ? 'neutral' : server.kind === 'ok' && server.health.status === 'ok' ? 'good' : 'bad'}
          />
          {db && <StatusRow label="Database" value={db.status === 'up' ? 'Up' : 'Down'} tone={db.status === 'up' ? 'good' : 'bad'} />}
        </View>

        {server.kind === 'unreachable' && (
          <Text accessibilityRole="alert" className="rounded-lg bg-warning-50 p-4 text-base text-warning-700">
            {server.message}. Work saved on this phone will sync when the server can be reached.
          </Text>
        )}

        <Pressable
          onPress={check}
          disabled={server.kind === 'checking'}
          accessibilityRole="button"
          className="min-h-14 items-center justify-center rounded-xl bg-brand-600 px-4 active:bg-brand-700 disabled:opacity-60"
        >
          {server.kind === 'checking' ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-lg font-semibold text-white">Check again</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
