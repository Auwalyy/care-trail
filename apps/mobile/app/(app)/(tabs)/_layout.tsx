import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { useT } from '@/utils/i18n';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 22 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const t = useT();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#1d5bcf',
        tabBarInactiveTintColor: '#475569',
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        tabBarStyle: { height: 64, paddingBottom: 8, paddingTop: 6 },
      }}
    >
      <Tabs.Screen name="home" options={{ title: t('home'), tabBarIcon: icon('⌂') }} />
      <Tabs.Screen name="patients" options={{ title: t('patients'), tabBarIcon: icon('☺') }} />
      <Tabs.Screen name="referrals" options={{ title: t('referrals'), tabBarIcon: icon('⇄') }} />
      <Tabs.Screen name="tasks" options={{ title: t('tasks'), tabBarIcon: icon('✓') }} />
      <Tabs.Screen name="profile" options={{ title: t('profile'), tabBarIcon: icon('☰') }} />
    </Tabs>
  );
}
