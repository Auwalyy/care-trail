import { Text, View } from 'react-native';

type Tone = 'good' | 'bad' | 'neutral';

const DOT: Record<Tone, string> = {
  good: 'bg-success-700',
  bad: 'bg-danger-700',
  neutral: 'bg-ink-subtle',
};

export function StatusRow({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <View
      className="min-h-14 flex-row items-center justify-between border-b border-border py-3"
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <View className="flex-row items-center gap-3">
        <View className={`h-3 w-3 rounded-full ${DOT[tone]}`} />
        <Text className="text-base text-ink-muted">{label}</Text>
      </View>
      <Text className="text-base font-semibold text-ink">{value}</Text>
    </View>
  );
}
