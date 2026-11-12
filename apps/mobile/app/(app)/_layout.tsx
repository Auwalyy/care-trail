import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/store/session';

/** Everything here needs an unlocked session; otherwise go back through the entry gate. */
export default function AppLayout() {
  const phase = useSession((s) => s.phase);
  if (phase !== 'unlocked') return <Redirect href="/" />;
  // Tabs draw their own chrome; every pushed screen gets a header with a large back button.
  return (
    <Stack screenOptions={{ headerTitle: '', headerShadowVisible: false, headerTintColor: '#1d5bcf', headerStyle: { backgroundColor: '#f5f7fa' }, contentStyle: { backgroundColor: '#f5f7fa' } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
