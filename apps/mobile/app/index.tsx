import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '@/store/session';

/** Entry: route by session phase. */
export default function Index() {
  const phase = useSession((s) => s.phase);
  if (phase === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color="#1d5bcf" size="large" />
      </View>
    );
  }
  if (phase === 'signed_out') return <Redirect href="/login" />;
  if (phase === 'needs_pin_setup') return <Redirect href="/set-pin" />;
  if (phase === 'locked') return <Redirect href="/unlock" />;
  return <Redirect href="/home" />;
}
