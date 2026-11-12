import type { Metadata } from 'next';
import { AppointmentsPage } from '@/features/care/appointments-page';

export const metadata: Metadata = { title: 'Appointments' };

export default function Page() {
  return <AppointmentsPage />;
}
