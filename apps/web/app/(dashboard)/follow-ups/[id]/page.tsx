import type { Metadata } from 'next';
import { FollowUpDetail } from '@/features/care/follow-up-detail';

export const metadata: Metadata = { title: 'Follow-up', referrer: 'no-referrer' };

export default async function Page({ params }: PageProps<'/follow-ups/[id]'>) {
  const { id } = await params;
  return <FollowUpDetail id={id} />;
}
