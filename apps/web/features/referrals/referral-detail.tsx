'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { REFERRAL_STATUS_LABELS } from '@caretrail/shared-types';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, TableSkeleton } from '@/components/states/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RequirePermission } from '@/features/auth/require-session';
import { useSession } from '@/features/auth/session-store';
import { formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';
import { ReferralActions } from './referral-actions';
import { ReferralFlags, ReferralStatusBadge } from './referral-labels';
import { ReferralSummary } from './referral-summary';

function Timeline({ id }: { id: string }) {
  const events = useQuery({ queryKey: ['referral', 'history', id], queryFn: () => api.referrals.history(id) });
  if (events.isPending) return <TableSkeleton rows={3} cols={2} />;
  if (events.isError) return <ErrorState error={events.error} onRetry={() => events.refetch()} />;
  return (
    <ol className="relative grid gap-5 border-s ps-6">
      {events.data.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -start-[1.95rem] top-1 size-3 rounded-full border-2 border-background bg-teal-600" aria-hidden />
          <div className="text-sm font-medium">
            {e.kind === 'priority' ? `Priority set to ${e.priority}` : e.toStatus ? REFERRAL_STATUS_LABELS[e.toStatus] : 'Updated'}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDateTime(e.at)} · {e.actor.name ?? 'Unknown'}{e.source === 'mobile' ? ' · mobile app' : ''}
          </div>
          {e.note && <p className="mt-1 text-sm">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

function DetailContent({ id }: { id: string }) {
  const role = useSession((s) => s.user!.role);
  const query = useQuery({ queryKey: ['referral', id], queryFn: () => api.referrals.get(id) });
  if (query.isPending) return <Skeleton className="h-72 w-full" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const r = query.data;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ms-2"><Link href="/referrals"><ArrowLeft aria-hidden /> All referrals</Link></Button>
      <PageHeader
        title={`Referral ${r.referralCode}`}
        description={r.patient.fullName}
        actions={<Button asChild variant="outline" className="h-9"><Link href={`/referrals/${r.id}/receipt`} target="_blank"><Printer aria-hidden /> Print receipt</Link></Button>}
      />
      <div className="mb-6 flex flex-wrap items-center gap-2"><ReferralStatusBadge status={r.status} /><ReferralFlags r={r} /></div>
      {r.overdue && (
        <Alert className="mb-6 border-warning-700/30 bg-warning-50">
          <AlertTitle>The patient has not been confirmed at the facility</AlertTitle>
          <AlertDescription>The expected arrival date has passed. The community health worker should follow up with the patient.</AlertDescription>
        </Alert>
      )}
      <div className="mb-6"><ReferralActions referral={r} role={role} /></div>
      <ReferralSummary r={r} />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Outcome</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {r.arrival && <p><span className="text-muted-foreground">Arrived:</span> {formatDateTime(r.arrival.at)} · {r.arrival.by.name}</p>}
            {r.service && <div><p className="text-muted-foreground">Services provided ({formatDateTime(r.service.at)} · {r.service.by.name})</p><p className="mt-1 whitespace-pre-line">{r.service.summary}</p></div>}
            {r.followUpNote && <div><p className="text-muted-foreground">Further follow-up</p><p className="mt-1 whitespace-pre-line">{r.followUpNote}</p></div>}
            {r.completion && <p><span className="text-muted-foreground">Completed:</span> {formatDateTime(r.completion.at)} · {r.completion.by.name}</p>}
            {r.cancellation && <div><p className="text-muted-foreground">Cancelled {formatDateTime(r.cancellation.at)} · {r.cancellation.by.name}</p><p className="mt-1">{r.cancellation.reason}</p></div>}
            {!r.arrival && !r.cancellation && <p className="text-muted-foreground">Waiting for the patient to arrive.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
          <CardContent><Timeline id={r.id} /></CardContent>
        </Card>
      </div>
    </>
  );
}

export function ReferralDetail({ id }: { id: string }) {
  return (
    <RequirePermission permission="referral:read">
      <DetailContent id={id} />
    </RequirePermission>
  );
}
