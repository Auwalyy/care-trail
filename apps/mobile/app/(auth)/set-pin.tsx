import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, Field, Screen, Title } from '@/components/ui';
import { setPin } from '@/store/session';
import { useT } from '@/utils/i18n';

export default function SetPin() {
  const t = useT();
  const router = useRouter();
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^\d{4,6}$/.test(pin);

  const save = async () => {
    if (pin !== confirm) return setError(t('pinsDontMatch'));
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin)) return setError('Choose a less obvious PIN');
    setBusy(true);
    await setPin(pin);
    router.replace('/');
  };

  return (
    <Screen>
      <Title sub={t('setPinHelp')}>{t('setPinTitle')}</Title>
      <Card className="gap-4">
        <Field label={t('setPinTitle')} value={pin} onChangeText={(v) => setPinValue(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry />
        <Field label={t('confirmPin')} value={confirm} onChangeText={(v) => setConfirm(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry />
        {error ? <Text accessibilityRole="alert" className="text-base text-danger-700">{error}</Text> : null}
        <Button label={t('save')} onPress={save} disabled={!valid || confirm.length < 4} busy={busy} />
      </Card>
    </Screen>
  );
}
