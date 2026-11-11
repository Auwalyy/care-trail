'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AuditTable } from '@/features/audit/audit-page';
import { RequirePermission } from '@/features/auth/require-session';
import { useCan } from '@/features/auth/session-store';
import { useCommunities } from '@/features/directory/use-directory';
import { IssuedLinkDialog, type IssuedLinkInfo } from '@/features/users/issued-link-dialog';
import { LANGUAGE_LABELS, STATUS_BADGE, STATUS_LABELS, formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';
import { ChwActions } from './chw-actions';
import { EditChwProfileDialog } from './chw-dialogs';
import { SyncStatus } from './chws-page';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-3 text-sm last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{children}</dd>
    </div>
  );
}

function ChwDetailContent({ id }: { id: string }) {
  const canAudit = useCan('audit:read');
  const communities = useCommunities();
  const chwQuery = useQuery({ queryKey: ['chws', id], queryFn: () => api.chws.get(id) });
  const chw = chwQuery.data;
  const supervisor = useQuery({
    queryKey: ['users', chw?.supervisorUserId],
    queryFn: () => api.users.get(chw!.supervisorUserId!),
    enabled: Boolean(chw?.supervisorUserId),
  });
  const [editing, setEditing] = useState(false);
  const [issued, setIssued] = useState<IssuedLinkInfo | null>(null);

  if (chwQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (chwQuery.isError || !chw) return <ErrorState error={chwQuery.error} onRetry={() => chwQuery.refetch()} />;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ms-2">
        <Link href="/chws"><ArrowLeft aria-hidden /> All health workers</Link>
      </Button>
      <PageHeader
        title={chw.user.fullName}
        description={chw.user.email}
        actions={<ChwActions chw={chw} showView={false} onEdit={() => setEditing(true)} onLinkIssued={setIssued} />}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Programme profile</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <Row label="Account"><Badge variant="outline" className={STATUS_BADGE[chw.user.status]}>{STATUS_LABELS[chw.user.status]}</Badge></Row>
              <Row label="Communities">{chw.user.communityIds.map((c) => communities.names.get(c) ?? '—').join(', ') || '—'}</Row>
              <Row label="Programme areas">{chw.programmeAreas.join(', ') || '—'}</Row>
              <Row label="Referrals">{chw.canIssueReferrals ? 'Authorised to issue' : 'Not authorised'}</Row>
              <Row label="Supervisor">{chw.supervisorUserId ? (supervisor.data?.fullName ?? '…') : '—'}</Row>
              <Row label="Phone">{chw.user.phone ?? '—'}</Row>
              <Row label="App language">{LANGUAGE_LABELS[chw.user.preferredLanguage]}</Row>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Smartphone className="size-5 text-brand-600" aria-hidden /> Mobile device</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <Row label="Last sync"><SyncStatus chw={chw} /></Row>
              <Row label="App version">{chw.device.appVersion ?? '—'}</Row>
              <Row label="Waiting to sync">{chw.device.pendingOperations ?? '—'}</Row>
              <Row label="Last sign-in">{formatDateTime(chw.user.lastLoginAt)}</Row>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">Device details are reported by the mobile app each time it synchronises.</p>
          </CardContent>
        </Card>
      </div>
      {canAudit && (
        <Card className="mt-6 gap-0 overflow-hidden p-0">
          <CardHeader className="border-b py-4"><CardTitle className="text-base">Activity</CardTitle></CardHeader>
          <AuditTable filters={{ actorId: chw.id, pageSize: 10 }} emptyTitle="No recorded activity yet" />
        </Card>
      )}
      {editing && <EditChwProfileDialog chw={chw} onClose={() => setEditing(false)} />}
      <IssuedLinkDialog info={issued} onClose={() => setIssued(null)} />
    </>
  );
}

export function ChwDetail({ id }: { id: string }) {
  return (
    <RequirePermission permission="chw:read">
      <ChwDetailContent id={id} />
    </RequirePermission>
  );
}
