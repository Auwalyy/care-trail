import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Reusable mobile building blocks. Touch targets are at least 48dp; text is large enough for
 * outdoor use on small, low-end screens.
 */
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      {scroll ? <ScrollView contentContainerClassName="gap-4 p-4 pb-12" keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View className="flex-1 gap-4 p-4">{children}</View>}
    </SafeAreaView>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View>
      <Text className="text-2xl font-bold text-brand-900">{children}</Text>
      {sub ? <Text className="mt-1 text-base text-ink-muted">{sub}</Text> : null}
    </View>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <View className={`rounded-xl border border-border bg-surface p-4 ${className}`}>{children}</View>;
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const BTN: Record<Variant, string> = {
  primary: 'bg-brand-600 active:bg-brand-700',
  secondary: 'border border-border bg-surface active:bg-canvas',
  danger: 'bg-danger-700',
  ghost: 'active:bg-canvas',
};
const BTN_TEXT: Record<Variant, string> = { primary: 'text-white', secondary: 'text-ink', danger: 'text-white', ghost: 'text-brand-700' };

export function Button({ label, onPress, variant = 'primary', disabled, busy }: { label: string; onPress: () => void; variant?: Variant; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
      className={`min-h-14 flex-row items-center justify-center gap-2 rounded-xl px-4 ${BTN[variant]} ${disabled ? 'opacity-50' : ''}`}
    >
      {busy ? <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : '#1d5bcf'} /> : null}
      <Text className={`text-lg font-semibold ${BTN_TEXT[variant]}`}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, error, hint, ...input }: { label: string; error?: string | undefined; hint?: string } & TextInputProps) {
  return (
    <View className="gap-1">
      <Text className="text-base font-medium text-ink">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#64748b"
        className={`min-h-14 rounded-xl border bg-surface px-4 text-lg text-ink ${error ? 'border-danger-700' : 'border-border'}`}
        {...input}
      />
      {error ? <Text accessibilityRole="alert" className="text-base text-danger-700">{error}</Text> : hint ? <Text className="text-sm text-ink-subtle">{hint}</Text> : null}
    </View>
  );
}

/** Large tappable options (instead of small dropdowns). */
export function Choice<T extends string>({ label, value, options, onChange, error }: { label: string; value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void; error?: string | undefined }) {
  return (
    <View className="gap-2">
      <Text className="text-base font-medium text-ink">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className={`min-h-12 justify-center rounded-xl border px-4 ${selected ? 'border-brand-600 bg-brand-50' : 'border-border bg-surface'}`}
            >
              <Text className={`text-base ${selected ? 'font-semibold text-brand-700' : 'text-ink'}`}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text accessibilityRole="alert" className="text-base text-danger-700">{error}</Text> : null}
    </View>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value }} className="min-h-14 flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4">
      <View className={`h-6 w-6 items-center justify-center rounded border-2 ${value ? 'border-brand-600 bg-brand-600' : 'border-ink-subtle'}`}>{value ? <Text className="font-bold text-white">✓</Text> : null}</View>
      <Text className="flex-1 text-base text-ink">{label}</Text>
    </Pressable>
  );
}

const BADGE: Record<string, string> = {
  info: 'bg-brand-50 text-brand-700',
  ok: 'bg-success-50 text-success-700',
  warn: 'bg-warning-50 text-warning-700',
  bad: 'bg-danger-50 text-danger-700',
  muted: 'bg-canvas text-ink-muted',
};
export function Badge({ label, tone = 'info' }: { label: string; tone?: keyof typeof BADGE }) {
  return <Text className={`self-start overflow-hidden rounded-full px-3 py-1 text-sm font-semibold ${BADGE[tone]}`}>{label}</Text>;
}

export function ListRow({ title, subtitle, right, onPress }: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} className="min-h-16 flex-row items-center gap-3 border-b border-border bg-surface px-4 py-3 active:bg-canvas">
      <View className="flex-1">
        <Text className="text-lg font-medium text-ink">{title}</Text>
        {subtitle ? <Text className="text-sm text-ink-muted">{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text className="py-10 text-center text-base text-ink-muted">{text}</Text>;
}
