import type { Metadata } from 'next';
import { VerifyReferralPage } from '@/features/referrals/verify-referral';

export const metadata: Metadata = { title: 'Verify referral' };

export default function Page() {
  return <VerifyReferralPage />;
}
