'use client';

import { useQuery } from '@tanstack/react-query';
import { HeartHandshake, Hospital, MapPinned, ShieldCheck, UsersRound, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { ROLE_LABELS } from '@caretrail/shared-types';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/states/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan, useSession } from '@/features/auth/session-store';
import { useFacilities, useOrganisations } from '@/features/directory/use-directory';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { SystemStatus } from '@/features/system/system-status';
import { formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';

function StatCard({
  icon: Icon,
  label,
  value,
  target,
  detail,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  target?: number | null | undefined;
  detail?: string | undefined;
  href?: string | undefined;
}) {
  const pct = target ? Math.min(100, Math.round((value / target) * 100)) : null;
  const body = (
    <Card className="h-full gap-3 py-5 transition-shadow hover:shadow-md">
      <CardContent className="grid gap-3 px-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon className="size-5" aria-hidden /></span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight text-brand-900">{value}</span>
          {target ? <span className="text-sm text-muted-foreground">of {target} target</span> : null}
        </div>
        {pct !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}: ${pct}% of target`}>
            <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
          </div>
        )}
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="rounded-xl focus-visible:outline-2">{body}</Link> : body;
}

function ProgrammeFigures() {
  const { isPlatform, organisationId } = useActiveOrganisation();
  const orgParam = isPlatform ? (organisationId ?? undefined) : undefined;
  const query = useQuery({ queryKey: ['overview', orgParam ?? 'own'], queryFn: () => api.analytics.overview(orgParam), refetchInterval: 120_000 });

  if (query.isPending) return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36" />)}</div>;
  if (query.isError) return <Card><ErrorState error={query.error} onRetry={() => query.refetch()} /></Card>;
  const o = query.data;
  const p = o.pilot;

  return (
    <section aria-labelledby="figures-heading" className="grid gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="figures-heading" className="text-base font-semibold">Programme set-up</h2>
        <span className="text-xs text-muted-foreground">Updated {formatDateTime(o.generatedAt)}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={MapPinned} label="Active communities" value={o.communities.active} target={p?.communities} href="/communities" detail={o.communities.total > o.communities.active ? `${o.communities.total - o.communities.active} inactive` : undefined} />
        <StatCard icon={Hospital} label="Active facilities" value={o.facilities.active} target={p?.facilities} href="/facilities" detail={o.facilities.total > o.facilities.active ? `${o.facilities.total - o.facilities.active} inactive` : undefined} />
        <StatCard icon={HeartHandshake} label="Active health workers" value={o.chws.active} target={p?.chws} href="/chws" detail={o.chws.pendingActivation ? `${o.chws.pendingActivation} awaiting activation` : undefined} />
        <StatCard icon={UsersRound} label="Programme & facility staff" value={o.staff.active} href="/users" detail={o.staff.total > o.staff.active ? `${o.staff.total - o.staff.active} not active` : undefined} />
      </div>
      {o.organisationId && !p?.chws && !p?.facilities && !p?.communities && (
        <p className="text-sm text-muted-foreground">
          Pilot targets are not set. <Link href="/settings" className="font-medium text-brand-700 hover:underline">Set them in Programme settings</Link> to track progress.
        </p>
      )}
      <p className="text-xs text-muted-foreground">Patient enrolment, referral and follow-up figures appear here once those modules are in use.</p>
    </section>
  );
}

export function DashboardOverview() {
  const user = useSession((s) => s.user)!;
  const canSeeFigures = useCan('analytics:read');
  const orgs = useOrganisations();
  const facilities = useFacilities();
  const firstName = user.fullName.split(' ')[0];
  const scope =
    user.role === 'platform_admin'
      ? 'All organisations'
      : [user.organisationId ? orgs.names.get(user.organisationId) : null, user.facilityId ? facilities.names.get(user.facilityId) : null].filter(Boolean).join(' · ') || '—';

  return (
    <>
      <PageHeader title={`Welcome, ${firstName}`} description="Overview of your CARETRAIL workspace." actions={<OrganisationPicker allowAll />} />
      <div className="grid gap-6">
        {canSeeFigures && <ProgrammeFigures />}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-5 text-teal-600" aria-hidden /> Your access</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Role</dt><dd className="font-medium">{ROLE_LABELS[user.role]}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Scope</dt><dd className="text-end font-medium">{scope}</dd></div>
              </dl>
            </CardContent>
          </Card>
          <SystemStatus />
        </div>
      </div>
    </>
  );
}
