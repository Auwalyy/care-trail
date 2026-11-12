import { Alert, Text, View } from 'react-native';
import type { SyncOpType } from '@caretrail/shared-types';
import type { OutboxEntry } from '@caretrail/sync-core';
import { Badge, Button, Card, Empty, Screen, Title } from '@/components/ui';
import { SyncBanner } from '@/components/sync-banner';
import { discardOp, listOutbox, reapplyOnLatest, registerAnyway, retryOp } from '@/database/repo';
import { scheduleSync } from '@/services/sync';
import { useLocalQuery } from '@/store/data-version';
import { useT } from '@/utils/i18n';

const OP_LABEL: Record<SyncOpType, string> = {
  'patient.register': 'Patient registration',
  'patient.update': 'Contact details',
  'consent.record': 'Consent',
  'visit.create': 'Visit',
  'referral.create': 'Referral',
  'appointment.create': 'Appointment',
  'followup.create': 'Follow-up',
  'followup.attempt': 'Contact attempt',
  'followup.resolve': 'Follow-up resolved',
};

/** Outbox: what is waiting, what failed and why, and what the CHW can do about conflicts. */
export default function SyncScreen() {
  const t = useT();
  const ops = useLocalQuery(listOutbox).data ?? [];
  const act = (fn: (id: string) => Promise<void>, opId: string) => void fn(opId).then(() => scheduleSync(500));
  const confirmDiscard = (op: OutboxEntry) =>
    Alert.alert(t('discard'), 'This change, and anything that depends on it, will be removed from this phone.', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('discard'), style: 'destructive', onPress: () => act(discardOp, op.opId) },
    ]);

  return (
    <Screen>
      <Title>{t('syncStatus')}</Title>
      <SyncBanner />
      {ops.length === 0 ? <Empty text={t('allSynced')} /> : null}
      {ops.map((op) => {
        const conflict = op.status === 'conflict';
        const isDup = conflict && op.opType === 'patient.register';
        const tone = conflict ? 'warn' : op.permanent ? 'bad' : op.status === 'failed' ? 'warn' : 'muted';
        const label = conflict ? t('conflict') : op.permanent ? t('rejected') : op.status === 'failed' ? t('failed') : t('pendingSync');
        return (
          <Card key={op.opId} className="gap-3">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-lg font-medium text-ink">{OP_LABEL[op.opType] ?? op.opType}</Text>
              <Badge label={label} tone={tone} />
            </View>
            <Text className="text-sm text-ink-muted">{op.createdAt.slice(0, 16).replace('T', ' ')}{op.retryCount ? ` · ${op.retryCount}×` : ''}</Text>
            {op.lastError ? <Text className="text-base text-ink">{op.lastError}</Text> : null}
            {isDup ? <Button label={t('registerAnyway')} onPress={() => act(registerAnyway, op.opId)} /> : null}
            {conflict && !isDup ? <Button label={t('keepMine')} onPress={() => act(reapplyOnLatest, op.opId)} /> : null}
            {op.permanent || op.status === 'failed' ? <Button label={t('retry')} variant="secondary" onPress={() => act(retryOp, op.opId)} /> : null}
            {conflict || op.permanent ? <Button label={t('discard')} variant="danger" onPress={() => confirmDiscard(op)} /> : null}
          </Card>
        );
      })}
    </Screen>
  );
}
