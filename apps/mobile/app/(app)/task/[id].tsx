import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, FOLLOW_UP_REASON_LABELS, type ContactMethod } from '@caretrail/shared-types';
import { Badge, Button, Card, Choice, Field, Screen, Title, Toggle } from '@/components/ui';
import { LocalValidationError, getTask, recordAttemptOffline, resolveTaskOffline, type FieldErrors } from '@/database/repo';
import { useChw } from '@/hooks/use-chw';
import { scheduleSync } from '@/services/sync';
import { useLocalQuery } from '@/store/data-version';
import { useT } from '@/utils/i18n';

export default function TaskDetail() {
  const t = useT();
  const router = useRouter();
  const chw = useChw();
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useLocalQuery(() => getTask(id), [id]).data;
  const [method, setMethod] = useState<ContactMethod>('call');
  const [reached, setReached] = useState(false);
  const [response, setResponse] = useState('');
  const [outcome, setOutcome] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  if (!task) return <Screen><Title>{t('tasks')}</Title></Screen>;

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      scheduleSync();
      after?.();
    } catch (err) {
      if (err instanceof LocalValidationError) setErrors(err.fields);
      else Alert.alert('Error', String(err));
    } finally {
      setBusy(false);
    }
  };
  const resolved = task.status === 'resolved';

  return (
    <Screen>
      <Title sub={`${FOLLOW_UP_REASON_LABELS[task.reason]} · ${task.dueOn}`}>{task.patient.fullName}</Title>
      <View className="flex-row flex-wrap gap-2">
        <Badge label={task.status} tone={resolved ? 'ok' : task.overdue ? 'bad' : 'info'} />
        {task.source.label ? <Badge label={task.source.label} tone="muted" /> : null}
      </View>
      {task.note ? <Card><Text className="text-base text-ink">{task.note}</Text></Card> : null}

      {task.attempts.map((a, i) => (
        <Card key={`${a.at}-${i}`} className="gap-1">
          <Text className="text-base font-medium text-ink">{CONTACT_METHOD_LABELS[a.method]} · {a.reached ? '✓' : '✗'}</Text>
          <Text className="text-sm text-ink-muted">{a.at.slice(0, 16).replace('T', ' ')}{a.response ? ` · ${a.response}` : ''}</Text>
        </Card>
      ))}

      {resolved ? (
        <Card><Text className="text-base text-ink">{t('outcome')}: {task.outcome ?? '—'}</Text></Card>
      ) : (
        <>
          <Card className="gap-4">
            <Text className="text-lg font-semibold text-ink">{t('recordAttempt')}</Text>
            <Choice label={t('type')} value={method} onChange={setMethod} options={CONTACT_METHODS.map((m) => ({ value: m, label: CONTACT_METHOD_LABELS[m] }))} />
            <Toggle label={t('reached')} value={reached} onChange={setReached} />
            <Field label={t('notes')} value={response} onChangeText={setResponse} error={errors.response} />
            <Button
              label={t('save')}
              busy={busy}
              onPress={() => void run(() => recordAttemptOffline(task, { method, reached, response: response || null }, chw), () => { setResponse(''); setReached(false); })}
            />
          </Card>
          <Card className="gap-4">
            <Text className="text-lg font-semibold text-ink">{t('resolve')}</Text>
            <Field label={t('outcome')} value={outcome} onChangeText={setOutcome} error={errors.outcome} />
            <Button label={t('resolve')} variant="secondary" busy={busy} onPress={() => void run(() => resolveTaskOffline(task, outcome), () => router.back())} />
          </Card>
        </>
      )}
    </Screen>
  );
}
