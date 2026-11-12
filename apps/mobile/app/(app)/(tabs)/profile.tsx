import { useRouter } from 'expo-router';
import { Alert, Text } from 'react-native';
import { Button, Card, Screen, Title } from '@/components/ui';
import { dashboardCounts } from '@/database/repo';
import { useLocalQuery } from '@/store/data-version';
import { signOutAndWipe, useSession } from '@/store/session';
import { useLang, useT } from '@/utils/i18n';

export default function Profile() {
  const t = useT();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const { lang, setLang } = useLang();
  const unsynced = useLocalQuery(dashboardCounts).data?.unsynced ?? 0;

  const signOut = () =>
    Alert.alert(t('signOut'), t('signOutWarning', { n: unsynced }), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('signOut'), style: 'destructive', onPress: () => void signOutAndWipe().then(() => router.replace('/')) },
    ]);

  return (
    <Screen>
      <Title sub={user?.email}>{user?.fullName}</Title>
      <Card className="gap-3">
        <Text className="text-base font-medium text-ink">{t('language')}</Text>
        <Button label="Hausa" variant={lang === 'ha' ? 'primary' : 'secondary'} onPress={() => setLang('ha')} />
        <Button label="English" variant={lang === 'en' ? 'primary' : 'secondary'} onPress={() => setLang('en')} />
      </Card>
      <Button label={t('syncStatus')} variant="secondary" onPress={() => router.push('/sync')} />
      <Button label={t('signOut')} variant="danger" onPress={signOut} />
    </Screen>
  );
}
