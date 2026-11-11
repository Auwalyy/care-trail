import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { cn } from '@/lib/utils';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'CARETRAIL', template: '%s · CARETRAIL' },
  description: 'Community healthcare navigation, referral and follow-up — No Patient Left Behind.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // `dir` is set per language once right-to-left languages are added (components use logical CSS).
    <html lang="en" dir="ltr" className={cn('h-full antialiased', inter.variable)}>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
