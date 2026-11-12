import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { Button, Card, Choice, Field, Screen, Title, Toggle } from '@/components/ui';
import { LocalValidationError, approvedTemplates, createReferralOffline, getPatient, listFacilities, type FieldErrors } from '@/database/repo';
import { useChw } from '@/hooks/use-chw';
import { scheduleSync } from '@/services/sync';
import { useLocalQuery } from '@/store/data-version';
import { useT } from '@/utils/i18n';

export default function NewReferral() {
  const t = useT();
  const router = useRouter();
  const chw = useChw();
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const patient = useLocalQuery(() => getPatient(patientId), [patientId]).data;
  const facilities = useLocalQuery(listFacilities).data ?? [];
  const templates = useLocalQuery(approvedTemplates).data ?? [];
  const [toFacilityId, setFacility] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  // Facility-sharing consent is required to refer (the server enforces this too).
  if (patient && !patient.consent.facility_sharing?.granted) {
    return (
      <Screen>
        <Title>{t('refer')}</Title>
        <Text className="text-base text-ink-muted">{t('noSharingConsent')}</Text>
      </Screen>
    );
  }

  const save = async () => {
    if (!patient) return;
    setBusy(true);
    setErrors({});
    try {
      const id = await createReferralOffline(patient, { toFacilityId: toFacilityId ?? '', reason, instructionTemplateIds: selected }, chw);
      scheduleSync();
      router.replace({ pathname: '/referral/[id]', params: { id } });
    } catch (err) {
      if (err instanceof LocalValidationError) setErrors(err.fields);
      else Alert.alert('Error', String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title sub={patient?.fullName}>{t('refer')}</Title>
      <Card className="gap-4">
        <Choice label={t('facility')} value={toFacilityId} onChange={setFacility} options={facilities.map((f) => ({ value: f.id, label: f.name }))} error={errors.toFacilityId} />
        <Field label={t('reason')} value={reason} onChangeText={setReason} multiline error={errors.reason} />
        {templates.length ? <Text className="text-base font-medium text-ink">{t('instructions')}</Text> : null}
        {templates.map((tpl) => (
          <Toggle key={tpl.id} label={tpl.title} value={selected.includes(tpl.id)} onChange={(on) => setSelected((s) => (on ? [...s, tpl.id] : s.filter((x) => x !== tpl.id)))} />
        ))}
      </Card>
      <Button label={t('save')} onPress={() => void save()} busy={busy} disabled={!patient} />
    </Screen>
  );
}
