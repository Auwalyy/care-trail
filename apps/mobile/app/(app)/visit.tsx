import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { VISIT_OUTCOMES, VISIT_OUTCOME_LABELS, type VisitOutcome } from '@caretrail/shared-types';
import { Button, Card, Choice, Field, Screen, Title, Toggle } from '@/components/ui';
import { LocalValidationError, recordVisitOffline, type FieldErrors } from '@/database/repo';
import { todayIso, useChw } from '@/hooks/use-chw';
import { scheduleSync } from '@/services/sync';
import { useT } from '@/utils/i18n';

export default function RecordVisit() {
  const t = useT();
  const router = useRouter();
  const chw = useChw();
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const [visitDate, setVisitDate] = useState(todayIso());
  const [outcome, setOutcome] = useState<VisitOutcome>('met');
  const [followUpRequired, setFollowUp] = useState(false);
  const [nextActivityDate, setNext] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await recordVisitOffline(patientId, { visitDate, outcome, followUpRequired, nextActivityDate: nextActivityDate || null, notes: notes || null }, chw, chw.organisationId);
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
      <Title>{t('recordVisit')}</Title>
      <Card className="gap-4">
        <Field label={`${t('visitDate')} (YYYY-MM-DD)`} value={visitDate} onChangeText={setVisitDate} error={errors.visitDate} />
        <Choice label={t('visitOutcome')} value={outcome} onChange={setOutcome} options={VISIT_OUTCOMES.map((o) => ({ value: o, label: VISIT_OUTCOME_LABELS[o] }))} error={errors.outcome} />
        <Toggle label={t('followUpNeeded')} value={followUpRequired} onChange={setFollowUp} />
        {followUpRequired ? <Field label={`${t('nextDate')} (YYYY-MM-DD)`} value={nextActivityDate} onChangeText={setNext} error={errors.nextActivityDate} /> : null}
        <Field label={t('notes')} value={notes} onChangeText={setNotes} multiline error={errors.notes} />
      </Card>
      <Button label={t('save')} onPress={() => void save()} busy={busy} />
    </Screen>
  );
}
