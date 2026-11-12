import { useRouter } from 'expo-router';
import { renderNotification } from '@caretrail/shared-types';
import { Badge, Empty, ListRow, Screen, Title } from '@/components/ui';
import { listMessages } from '@/database/repo';
import { useLocalQuery } from '@/store/data-version';
import { useLang, useT } from '@/utils/i18n';

/**
 * In-app messages (new follow-up tasks, escalations), synced from the server. Read-only on the
 * phone; they are rendered in the CHW's language from the template, so they work offline.
 */
export default function Messages() {
  const t = useT();
  const { lang } = useLang();
  const router = useRouter();
  const messages = useLocalQuery(listMessages).data ?? [];
  return (
    <Screen>
      <Title>{t('messages')}</Title>
      {messages.length === 0 ? <Empty text={t('noMessages')} /> : null}
      {messages.map((m) => (
        <ListRow
          key={m.id}
          title={renderNotification(m.templateKey, lang, m.params ?? {})}
          subtitle={new Date(m.createdAt).toLocaleString()}
          right={m.readAt ? null : <Badge label="•" tone="info" />}
          {...(m.link?.type === 'follow_up' ? { onPress: () => router.push({ pathname: '/task/[id]', params: { id: m.link!.id } }) } : {})}
        />
      ))}
    </Screen>
  );
}
