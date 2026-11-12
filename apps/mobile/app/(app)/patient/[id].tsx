import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { APPOINTMENT_CATEGORY_LABELS, CARE_PATHWAY_LABELS, REFERRAL_STATUS_LABELS, VISIT_OUTCOME_LABELS } from '@caretrail/shared-types';
import { Badge, Button, Card, ListRow, Screen, Title } from '@/components/ui';
import { getPatient, isLocal, patientAppointments, patientReferrals, patientVisits } from '@/database/repo';
import { kvGet } from '@/database/db';
import { useLocalQuery } from '@/store/data-version';
import { useT } from '@/utils/i18n';

export default function PatientProfile() {
  const t = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const patient = useLocalQuery(() => getPatient(id), [id]).data;
  const referrals = useLocalQuery(() => patientReferrals(id), [id]).data ?? [];
  const appointments = useLocalQuery(() => patientAppointments(id), [id]).data ?? [];
  const visits = useLocalQuery(() => patientVisits(id), [id]).data ?? [];
  const canRefer = useLocalQuery(() => kvGet<boolean>('sync.canIssueReferrals')).data ?? false;

  if (!patient) return <Screen><Title>{t('patients')}</Title></Screen>;
  const pending = isLocal(patient.id);
  const sharing = patient.consent.facility_sharing?.granted;

  return (
    <Screen>
      <Title sub={pending ? t('pendingId') : patient.patientCode}>{patient.fullName}</Title>
      <View className="flex-row flex-wrap gap-2">
        <Badge label={CARE_PATHWAY_LABELS[patient.carePathway]} />
        {pending ? <Badge label={t('pendingSync')} tone="warn" /> : null}
        {patient.status !== 'active' ? <Badge label={patient.status} tone="muted" /> : null}
      </View>
      <Card className="gap-1">
        {patient.pathwayDetails.expectedDeliveryDate ? <Text className="text-base text-ink">Due: {patient.pathwayDetails.expectedDeliveryDate}</Text> : null}
        {patient.pathwayDetails.deliveryDate ? <Text className="text-base text-ink">Delivered: {patient.pathwayDetails.deliveryDate}</Text> : null}
        <Text className="text-base text-ink-muted">{patient.phone ?? 'No phone'}</Text>
      </Card>

      <Button label={t('recordVisit')} onPress={() => router.push({ pathname: '/visit', params: { patientId: patient.id } })} />
      <Button label={t('bookAppointment')} variant="secondary" onPress={() => router.push({ pathname: '/appointment', params: { patientId: patient.id } })} />
      {canRefer ? (
        sharing ? <Button label={t('refer')} variant="secondary" onPress={() => router.push({ pathname: '/referral/new', params: { patientId: patient.id } })} /> : <Text className="text-base text-ink-muted">{t('noSharingConsent')}</Text>
      ) : null}

      <Text className="mt-2 text-lg font-semibold text-ink">{t('referrals')}</Text>
      <View className="overflow-hidden rounded-xl border border-border">
        {referrals.length === 0 ? <ListRow title="—" /> : referrals.map((r) => (
          <ListRow key={r.id} title={isLocal(r.id) ? t('pendingSync') : r.referralCode} subtitle={REFERRAL_STATUS_LABELS[r.status]} onPress={() => router.push({ pathname: '/referral/[id]', params: { id: r.id } })} />
        ))}
      </View>
      <Text className="mt-2 text-lg font-semibold text-ink">Appointments</Text>
      <View className="overflow-hidden rounded-xl border border-border">
        {appointments.length === 0 ? <ListRow title="—" /> : appointments.map((a) => <ListRow key={a.id} title={`${a.scheduledFor} · ${APPOINTMENT_CATEGORY_LABELS[a.category]}`} subtitle={a.status} />)}
      </View>
      <Text className="mt-2 text-lg font-semibold text-ink">Visits</Text>
      <View className="overflow-hidden rounded-xl border border-border">
        {visits.length === 0 ? <ListRow title="—" /> : visits.map((v) => <ListRow key={v.id} title={v.visitDate} subtitle={VISIT_OUTCOME_LABELS[v.outcome]} right={isLocal(v.id) ? <Badge label={t('pendingSync')} tone="warn" /> : null} />)}
      </View>
    </Screen>
  );
}
