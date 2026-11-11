import type { Metadata } from 'next';
import { CommunitiesPage } from '@/features/communities/communities-page';

export const metadata: Metadata = { title: 'Communities' };

export default function Page() {
  return <CommunitiesPage />;
}
