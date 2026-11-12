import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { EDUCATION_CATEGORY_LABELS, type EducationContentDto } from '@caretrail/shared-types';
import { Empty, ListRow, Screen, Title } from '@/components/ui';
import { listEducation } from '@/database/repo';
import { useLocalQuery } from '@/store/data-version';
import { useLang, useT } from '@/utils/i18n';

/** Published, clinically reviewed education content, available offline. */
export default function Learn() {
  const t = useT();
  const { lang } = useLang();
  const router = useRouter();
  const items = useLocalQuery(listEducation).data ?? [];
  const groups = new Map<string, EducationContentDto[]>();
  for (const i of items) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);

  return (
    <Screen>
      <Title>{t('learn')}</Title>
      {items.length === 0 ? <Empty text={t('noLearning')} /> : null}
      {[...groups].map(([category, list]) => (
        <View key={category} className="gap-2">
          <Text className="text-lg font-semibold text-ink">{EDUCATION_CATEGORY_LABELS[category as keyof typeof EDUCATION_CATEGORY_LABELS]}</Text>
          <View className="overflow-hidden rounded-xl border border-border">
            {list.map((i) => (
              <ListRow key={i.id} title={lang === 'ha' && i.titleHa ? i.titleHa : i.title} onPress={() => router.push({ pathname: '/learn/[id]', params: { id: i.id } })} />
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}
