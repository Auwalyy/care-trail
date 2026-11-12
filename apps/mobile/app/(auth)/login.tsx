import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError } from '@caretrail/api-client';
import { Button, Card, Field, Screen } from '@/components/ui';
import { useConnectivity } from '@/hooks/use-connectivity';
import { api } from '@/services/api';
import { deviceId, useSession } from '@/store/session';
import { useLang, useT } from '@/utils/i18n';

export default function Login() {
  const t = useT();
  const router = useRouter();
  const net = useConnectivity();
  const { lang, setLang } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.login(email.trim(), password, 'mobile', await deviceId());
      if (res.user.role !== 'chw') {
        setError('This app is for community health workers. Please use the CARETRAIL website.');
        return;
      }
      await useSession.getState().setOnlineSession(res);
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? (err.isTransient ? t('needOnlineFirst') : err.message) : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View className="mt-8">
        <Text className="text-sm font-semibold uppercase tracking-wide text-brand-700">{t('tagline')}</Text>
        <Text className="mt-1 text-4xl font-bold text-brand-900">{t('appName')}</Text>
      </View>
      <View className="flex-row gap-2">
        {(['ha', 'en'] as const).map((l) => (
          <Button key={l} label={l === 'ha' ? 'Hausa' : 'English'} variant={lang === l ? 'primary' : 'secondary'} onPress={() => setLang(l)} />
        ))}
      </View>
      <Card className="gap-4">
        {net === 'offline' ? <Text className="rounded-lg bg-warning-50 p-3 text-base text-warning-700">{t('needOnlineFirst')}</Text> : null}
        <Field label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="username" />
        <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
        {error ? <Text accessibilityRole="alert" className="text-base text-danger-700">{error}</Text> : null}
        <Button label={busy ? t('signingIn') : t('signIn')} onPress={submit} busy={busy} disabled={!email || !password} />
      </Card>
    </Screen>
  );
}
