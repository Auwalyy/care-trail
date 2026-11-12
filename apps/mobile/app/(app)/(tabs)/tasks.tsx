import { useRouter } from 'expo-router';
import { FlatList, View } from 'react-native';
import { FOLLOW_UP_REASON_LABELS, type FollowUpTaskDto } from '@caretrail/shared-types';
import { Badge, Empty, ListRow, Screen, Title } from '@/components/ui';
import { listTasks } from '@/database/repo';
import { todayIso } from '@/hooks/use-chw';
import { useLocalQuery } from '@/store/data-version';
import { useT } from '@/utils/i18n';

export default function Tasks() {
  const t = useT();
  const router = useRouter();
  const tasks = useLocalQuery(() => listTasks(true)).data ?? [];
  const today = todayIso();
  return (
    <Screen scroll={false}>
      <Title>{t('tasks')}</Title>
      <View className="flex-1 overflow-hidden rounded-xl border border-border">
        <FlatList<FollowUpTaskDto>
          data={tasks}
          keyExtractor={(x) => x.id}
          ListEmptyComponent={<Empty text={t('noTasks')} />}
          renderItem={({ item }) => (
            <ListRow
              title={item.patient.fullName}
              subtitle={`${FOLLOW_UP_REASON_LABELS[item.reason]} · ${item.dueOn}`}
              right={item.dueOn < today ? <Badge label="!" tone="bad" /> : item.status === 'escalated' ? <Badge label="↑" tone="warn" /> : null}
              onPress={() => router.push({ pathname: '/task/[id]', params: { id: item.id } })}
            />
          )}
        />
      </View>
    </Screen>
  );
}
