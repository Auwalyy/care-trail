import type { Metadata } from 'next';
import { PatientsPage } from '@/features/patients/patients-page';

export const metadata: Metadata = { title: 'Patients' };

export default function Page() {
  return <PatientsPage />;
}
