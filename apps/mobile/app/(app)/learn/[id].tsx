import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { EDUCATION_CATEGORY_LABELS } from '@caretrail/shared-types';
import { Card, Screen, Title } from '@/components/ui';
import { getEducation } from '@/database/repo';
import { useLocalQuery } from '@/store/data-version';
import { useLang, useT } from '@/utils/i18n';

export default function LearnItem() {
  const t = useT();
  const { lang } = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useLocalQuery(() => getEducation(id), [id]).data;
  if (!item) return <Screen><Title>{t('learn')}</Title></Screen>;
  // Hausa only when the programme provided (and the reviewer approved) a Hausa version.
  const ha = lang === 'ha' && item.titleHa && item.bodyHa;
  return (
    <Screen>
      <Title sub={EDUCATION_CATEGORY_LABELS[item.category]}>{ha ? item.titleHa : item.title}</Title>
      <Card>
        <Text className="text-lg leading-7 text-ink">{ha ? item.bodyHa : item.body}</Text>
      </Card>
      {item.audio.en || item.audio.ha ? <Text className="text-base text-ink-muted">{t('audioOnline')}</Text> : null}
      {item.approval ? (
        <Text className="text-sm text-ink-subtle">
          {t('reviewedBy')}: {item.approval.reviewerName}, {item.approval.reviewerCredentials} · {item.approval.approvedOn}
        </Text>
      ) : null}
    </Screen>
  );
}
