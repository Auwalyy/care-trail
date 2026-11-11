import { RequireSession } from '@/features/auth/require-session';
import { AppShell } from '@/features/shell/app-shell';

export default function DashboardLayout({ children }: LayoutProps<'/'>) {
  return (
    <RequireSession>
      <AppShell>{children}</AppShell>
    </RequireSession>
  );
}
