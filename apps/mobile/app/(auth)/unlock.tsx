import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, Field, Screen, Title } from '@/components/ui';
import { syncSettings } from '@/database/repo';
import { refreshAccessToken } from '@/services/api';
import { signOutAndWipe, unlockWithPin, useSession } from '@/store/session';
import { useT } from '@/utils/i18n';

export default function Unlock() {
  const t = useT();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const grace = (await syncSettings().catch(() => null))?.offlineSessionGraceDays;
    const r = await unlockWithPin(pin, grace);
    setBusy(false);
    setPin('');
    if (r.ok) {
      void refreshAccessToken(); // best effort: works offline too
      router.replace('/');
      return;
    }
    if (r.reason === 'wrong_pin') return setError(t('wrongPin', { n: r.attemptsLeft ?? 0 }));
    // Too many attempts or offline too long: an online sign-in is required (local data is kept).
    setError(r.reason === 'grace_expired' ? t('graceExpired') : t('tooManyAttempts'));
    useSession.getState().reset('signed_out');
  };

  return (
    <Screen>
      <Title sub={user?.fullName}>{t('unlockTitle')}</Title>
      <Card className="gap-4">
        <Field label="PIN" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry autoFocus />
        {error ? <Text accessibilityRole="alert" className="text-base text-danger-700">{error}</Text> : null}
        <Button label={t('unlock')} onPress={submit} busy={busy} disabled={pin.length < 4} />
      </Card>
      <Button label={t('signOut')} variant="ghost" onPress={() => void signOutAndWipe().then(() => router.replace('/'))} />
    </Screen>
  );
}
