import type { Metadata } from 'next';
import { ChwsPage } from '@/features/chws/chws-page';

export const metadata: Metadata = { title: 'Health workers' };

export default function Page() {
  return <ChwsPage />;
}
