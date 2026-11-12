import type { Metadata } from 'next';
import { RegisterPatientPage } from '@/features/patients/register-patient-form';

export const metadata: Metadata = { title: 'Register patient' };

export default function Page() {
  return <RegisterPatientPage />;
}
