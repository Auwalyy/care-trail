import type { Metadata } from 'next';
import { ChwDetail } from '@/features/chws/chw-detail';

export const metadata: Metadata = { title: 'Health worker' };

export default async function Page({ params }: PageProps<'/chws/[id]'>) {
  const { id } = await params;
  return <ChwDetail id={id} />;
}
