import type { Metadata } from 'next';
import { EducationPage } from '@/features/education/education-page';

export const metadata: Metadata = { title: 'Health education' };

export default function Page() {
  return <EducationPage />;
}
