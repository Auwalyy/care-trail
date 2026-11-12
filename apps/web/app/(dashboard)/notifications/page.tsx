import type { Metadata } from 'next';
import { InboxPage } from '@/features/notifications/inbox-page';

export const metadata: Metadata = { title: 'Messages' };

export default function Page() {
  return <InboxPage />;
}
