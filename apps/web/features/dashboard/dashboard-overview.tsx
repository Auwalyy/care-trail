'use client';

import { ShieldCheck } from 'lucide-react';
import { ROLE_LABELS } from '@caretrail/shared-types';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/features/auth/session-store';
import { useFacilities, useOrganisations } from '@/features/directory/use-directory';
import { SystemStatus } from '@/features/system/system-status';

/**
 * Shows only real information: the signed-in account and live system health. Programme figures
 * (patients, referrals, follow-ups) appear here once those modules exist — never placeholder numbers.
 */
export function DashboardOverview() {
  const user = useSession((s) => s.user)!;
  const orgs = useOrganisations();
  const facilities = useFacilities();
  const firstName = user.fullName.split(' ')[0];

  const scope =
    user.role === 'platform_admin'
      ? 'All organisations'
      : [
          user.organisationId ? orgs.names.get(user.organisationId) : null,
          user.facilityId ? facilities.names.get(user.facilityId) : null,
        ]
          .filter(Boolean)
          .join(' · ') || '—';

  return (
    <>
      <PageHeader title={`Welcome, ${firstName}`} description="Overview of your CARETRAIL workspace." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-5 text-teal-600" aria-hidden /> Your access
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Role</dt>
                <dd className="font-medium">{ROLE_LABELS[user.role]}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Scope</dt>
                <dd className="text-end font-medium">{scope}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Permissions</dt>
                <dd className="font-medium">{user.permissions.length}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <SystemStatus />
      </div>
    </>
  );
}
