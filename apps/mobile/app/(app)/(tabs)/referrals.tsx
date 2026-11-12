import { useRouter } from 'expo-router';
import { FlatList, View } from 'react-native';
import { REFERRAL_STATUS_LABELS, type ReferralDto } from '@caretrail/shared-types';
import { Badge, Empty, ListRow, Screen, Title } from '@/components/ui';
import { isLocal, listReferrals } from '@/database/repo';
import { useLocalQuery } from '@/store/data-version';
import { useT } from '@/utils/i18n';

export default function Referrals() {
  const t = useT();
  const router = useRouter();
  const referrals = useLocalQuery(listReferrals).data ?? [];
  return (
    <Screen scroll={false}>
      <Title>{t('referrals')}</Title>
      <View className="flex-1 overflow-hidden rounded-xl border border-border">
        <FlatList<ReferralDto>
          data={referrals}
          keyExtractor={(r) => r.id}
          ListEmptyComponent={<Empty text="—" />}
          renderItem={({ item }) => (
            <ListRow
              title={item.patient.fullName}
              subtitle={isLocal(item.id) ? t('pendingSync') : `${item.referralCode} · ${REFERRAL_STATUS_LABELS[item.status]}`}
              right={isLocal(item.id) ? <Badge label={t('pendingSync')} tone="warn" /> : item.overdue ? <Badge label="!" tone="bad" /> : null}
              onPress={() => router.push({ pathname: '/referral/[id]', params: { id: item.id } })}
            />
          )}
        />
      </View>
    </Screen>
  );
}
