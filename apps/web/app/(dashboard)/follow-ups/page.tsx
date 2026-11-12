import type { Metadata } from 'next';
import { FollowUpsPage } from '@/features/care/follow-ups-page';

export const metadata: Metadata = { title: 'Follow-ups' };

export default function Page() {
  return <FollowUpsPage />;
}
