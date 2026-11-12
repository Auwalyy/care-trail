import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { APPOINTMENT_CATEGORIES, APPOINTMENT_CATEGORY_LABELS, type AppointmentCategory } from '@caretrail/shared-types';
import { Button, Card, Choice, Field, Screen, Title } from '@/components/ui';
import { LocalValidationError, bookAppointmentOffline, getPatient, listFacilities, type FieldErrors } from '@/database/repo';
import { plusDaysIso, useChw } from '@/hooks/use-chw';
import { scheduleSync } from '@/services/sync';
import { useLocalQuery } from '@/store/data-version';
import { useT } from '@/utils/i18n';

export default function BookAppointment() {
  const t = useT();
  const router = useRouter();
  const chw = useChw();
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const patient = useLocalQuery(() => getPatient(patientId), [patientId]).data;
  const facilities = useLocalQuery(listFacilities).data ?? [];
  const [facilityId, setFacility] = useState<string | null>(null);
  const [category, setCategory] = useState<AppointmentCategory | null>(null);
  const [scheduledFor, setDate] = useState(plusDaysIso(7));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!patient) return;
    setBusy(true);
    setErrors({});
    try {
      await bookAppointmentOffline(patient, { facilityId: facilityId ?? '', category: category ?? '', scheduledFor }, chw);
      scheduleSync();
      router.back();
    } catch (err) {
      if (err instanceof LocalValidationError) setErrors(err.fields);
      else Alert.alert('Error', String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title sub={patient?.fullName}>{t('bookAppointment')}</Title>
      <Card className="gap-4">
        <Choice label={t('facility')} value={facilityId} onChange={setFacility} options={facilities.map((f) => ({ value: f.id, label: f.name }))} error={errors.facilityId} />
        <Choice label={t('type')} value={category} onChange={setCategory} options={APPOINTMENT_CATEGORIES.map((c) => ({ value: c, label: APPOINTMENT_CATEGORY_LABELS[c] }))} error={errors.category} />
        <Field label={`${t('date')} (YYYY-MM-DD)`} value={scheduledFor} onChangeText={setDate} error={errors.scheduledFor} />
      </Card>
      <Button label={t('save')} onPress={() => void save()} busy={busy} disabled={!patient} />
    </Screen>
  );
}
