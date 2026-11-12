import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/store/session';

/** Everything here needs an unlocked session; otherwise go back through the entry gate. */
export default function AppLayout() {
  const phase = useSession((s) => s.phase);
  if (phase !== 'unlocked') return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f5f7fa' } }} />;
}
