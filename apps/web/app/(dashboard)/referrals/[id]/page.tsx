import type { Metadata } from 'next';
import { ReferralDetail } from '@/features/referrals/referral-detail';

export const metadata: Metadata = { title: 'Referral', referrer: 'no-referrer' };

export default async function Page({ params }: PageProps<'/referrals/[id]'>) {
  const { id } = await params;
  return <ReferralDetail id={id} />;
}
