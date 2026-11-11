import { Suspense } from 'react';
import { RequireSession, ShellSkeleton } from '@/features/auth/require-session';
import { AppShell } from '@/features/shell/app-shell';

export default function DashboardLayout({ children }: LayoutProps<'/'>) {
  return (
    // The shell reads the pathname; on routes with request-time params (e.g. /chws/[id]) that
    // suspends during prerendering, so it needs a boundary (Cache Components).
    <Suspense fallback={<ShellSkeleton />}>
      <RequireSession>
        <AppShell>{children}</AppShell>
      </RequireSession>
    </Suspense>
  );
}
