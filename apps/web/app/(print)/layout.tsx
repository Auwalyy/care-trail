import { Suspense } from 'react';
import { RequireSession, ShellSkeleton } from '@/features/auth/require-session';

/** Signed-in pages without the app shell (printable documents). */
export default function PrintLayout({ children }: LayoutProps<'/'>) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <RequireSession>
        <main className="flex-1 bg-white px-4 py-8 print:p-0">{children}</main>
      </RequireSession>
    </Suspense>
  );
}
