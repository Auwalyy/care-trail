import type { Metadata } from 'next';
import { ReferralReceipt } from '@/features/referrals/referral-receipt';

export const metadata: Metadata = { title: 'Referral receipt', referrer: 'no-referrer' };

export default async function Page({ params }: PageProps<'/referrals/[id]/receipt'>) {
  const { id } = await params;
  return <ReferralReceipt id={id} />;
}
