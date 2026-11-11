'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { webLandingPath } from '@caretrail/shared-types';
import { useSession } from '@/features/auth/session-store';
import { Logo } from '@/components/brand/logo';

/** Entry point: send signed-in users to their landing page, everyone else to sign in. */
export default function HomePage() {
  const { status, user } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated' && user) router.replace(webLandingPath(user.role));
    if (status === 'anonymous') router.replace('/login');
  }, [status, user, router]);

  return (
    <div className="flex flex-1 items-center justify-center" role="status" aria-label="Loading">
      <Logo className="animate-pulse" />
    </div>
  );
}
