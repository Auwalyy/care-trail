import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { REFERRAL_STATUS_LABELS } from '@caretrail/shared-types';
import { Badge, Card, Screen, Title } from '@/components/ui';
import { getReferral, isLocal, listFacilities } from '@/database/repo';
import { useLocalQuery } from '@/store/data-version';
import { useLang, useT } from '@/utils/i18n';

/** Referral receipt shown to the patient. An unsynced referral has no code and says so plainly. */
export default function ReferralReceipt() {
  const t = useT();
  const { lang } = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const referral = useLocalQuery(() => getReferral(id), [id]).data;
  const facilities = useLocalQuery(listFacilities).data ?? [];
  if (!referral) return <Screen><Title>{t('referrals')}</Title></Screen>;
  const pending = isLocal(referral.id) || !referral.referralCode;
  const facility = facilities.find((f) => f.id === referral.toFacilityId);

  return (
    <Screen>
      <Title sub={referral.patient.fullName}>{t('referrals')}</Title>
      <Card className={`items-center gap-2 ${pending ? 'border-warning-700' : ''}`}>
        <Text className="text-base text-ink-muted">{t('referralCode')}</Text>
        {pending ? (
          <Text accessibilityRole="alert" className="text-center text-lg font-bold text-warning-700">{t('receiptPending')}</Text>
        ) : (
          <Text selectable className="text-4xl font-bold tracking-widest text-brand-900">{referral.referralCode}</Text>
        )}
        <Badge label={pending ? t('pendingSync') : REFERRAL_STATUS_LABELS[referral.status]} tone={pending ? 'warn' : 'info'} />
      </Card>
      <Card className="gap-1">
        <Text className="text-base font-medium text-ink">{t('facility')}</Text>
        <Text className="text-lg text-ink">{facility?.name ?? '—'}</Text>
        {facility?.address ? <Text className="text-base text-ink-muted">{facility.address}</Text> : null}
        <Text className="mt-2 text-base text-ink-muted">{t('date')}: {referral.expectedArrivalBy}</Text>
      </Card>
      {referral.instructions.length ? (
        <View className="gap-2">
          <Text className="text-lg font-semibold text-ink">{t('instructions')}</Text>
          {referral.instructions.map((i) => (
            <Card key={i.templateId} className="gap-1">
              <Text className="text-base font-semibold text-ink">{i.title}</Text>
              <Text className="text-base text-ink">{lang === 'ha' && i.bodyHa ? i.bodyHa : i.body}</Text>
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
