import type { Metadata } from 'next';
import { TemplatesPage } from '@/features/referrals/templates-page';

export const metadata: Metadata = { title: 'Referral instructions' };

export default function Page() {
  return <TemplatesPage />;
}
