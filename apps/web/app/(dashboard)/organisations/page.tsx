import type { Metadata } from 'next';
import { OrganisationsPage } from '@/features/organisations/organisations-page';

export const metadata: Metadata = { title: 'Organisations' };

export default function Page() {
  return <OrganisationsPage />;
}
