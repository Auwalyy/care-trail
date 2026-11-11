'use client';

import { ShieldAlert } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import type { Permission } from '@caretrail/shared-types';
import { EmptyState } from '@/components/states/states';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from './session-store';

/**
 * Client-side gate for the signed-in area. It only controls what is rendered — every request is
 * still authorised by the API, which is the real security boundary.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-full flex-1" role="status" aria-label="Loading your session">
        <div className="hidden w-60 border-e bg-sidebar p-4 md:block">
          <Skeleton className="mb-8 h-8 w-32" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="mb-3 h-6 w-full" />
          ))}
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="mb-6 h-8 w-48" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/** Renders a "no access" state instead of the page when a permission is missing. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const allowed = useSession((s) => s.user?.permissions.includes(permission) ?? false);
  if (!allowed) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="You do not have access to this page"
        description="Ask your programme administrator if you need this access."
      />
    );
  }
  return <>{children}</>;
}
