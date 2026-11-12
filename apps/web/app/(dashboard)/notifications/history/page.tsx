import type { Metadata } from 'next';
import { NotificationHistoryPage } from '@/features/notifications/history-page';

export const metadata: Metadata = { title: 'SMS & voice reminders' };

export default function Page() {
  return <NotificationHistoryPage />;
}
