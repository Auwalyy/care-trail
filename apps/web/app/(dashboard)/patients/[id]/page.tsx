import type { Metadata } from 'next';
import { PatientProfile } from '@/features/patients/patient-profile';

export const metadata: Metadata = { title: 'Patient', referrer: 'no-referrer' };

export default async function Page({ params }: PageProps<'/patients/[id]'>) {
  const { id } = await params;
  return <PatientProfile id={id} />;
}
