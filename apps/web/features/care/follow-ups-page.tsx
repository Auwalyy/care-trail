'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { FOLLOW_UP_REASONS, FOLLOW_UP_REASON_LABELS, type FollowUpReason, type FollowUpTaskDto } from '@caretrail/shared-types';
import type { ListFollowUpsParams } from '@caretrail/api-client';
import { DataTable, type Column } from '@/components/data/data-table';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, errorMessage } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RequirePermission } from '@/features/auth/require-session';
import { useCan } from '@/features/auth/session-store';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { formatDate } from '@/features/patients/patient-labels';
import { useActiveChws } from '@/features/patients/use-chws';
import { api } from '@/services/api';
import { TaskStatusBadge } from './care-labels';

type View = 'open' | 'overdue' | 'escalated' | 'resolved';
const ALL = '__all__';
const VIEW: Record<View, Partial<ListFollowUpsParams>> = {
  open: { open: 'true' },
  overdue: { overdue: 'true' },
  escalated: { status: 'escalated' },
  resolved: { status: 'resolved' },
};

function RunCheckButton({ organisationId }: { organisationId?: string | undefined }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      className="h-9"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api.followUps.runMissedCare(organisationId);
          toast.success(`Check complete: ${r.appointmentsMarkedMissed} missed appointment(s), ${r.referralsExpired} late referral(s), ${r.tasksCreated} new task(s).`);
          await Promise.all(['follow-ups', 'appointments', 'referrals', 'overview'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Run missed-care check
    </Button>
  );
}

function FollowUpsContent() {
  const canRun = useCan('settings:manage');
  const { isPlatform, organisationId } = useActiveOrganisation();
  const chws = useActiveChws(isPlatform ? organisationId : undefined);
  const [view, setView] = useState<View>('open');
  const [reason, setReason] = useState<FollowUpReason | typeof ALL>(ALL);
  const [chw, setChw] = useState(ALL);
  const [page, setPage] = useState(1);
  const needsOrg = isPlatform && !organisationId;
  const params: ListFollowUpsParams = { page, pageSize: 25, ...VIEW[view], ...(reason !== ALL ? { reason } : {}), ...(chw !== ALL ? { assignedChwId: chw } : {}), ...(isPlatform && organisationId ? { organisationId } : {}) };
  const query = useQuery({ queryKey: ['follow-ups', params], queryFn: () => api.followUps.list(params), placeholderData: keepPreviousData, enabled: !needsOrg });

  const columns: Column<FollowUpTaskDto>[] = [
    { key: 'patient', header: 'Patient', cell: (t) => <Link href={`/follow-ups/${t.id}`} className="group"><div className="font-medium group-hover:underline">{t.patient.fullName}</div><div className="font-mono text-xs text-muted-foreground">{t.patient.patientCode}</div></Link> },
    { key: 'reason', header: 'Why', cell: (t) => <><div>{FOLLOW_UP_REASON_LABELS[t.reason]}</div>{t.source.label && <div className="font-mono text-xs text-muted-foreground">{t.source.label}</div>}</> },
    { key: 'chw', header: 'Health worker', className: 'hidden md:table-cell', cell: (t) => t.assignedChw.name ?? '—' },
    { key: 'due', header: 'Due', className: 'whitespace-nowrap', cell: (t) => <span className={t.overdue ? 'font-medium text-danger-700' : ''}>{formatDate(t.dueOn)}</span> },
    { key: 'attempts', header: 'Attempts', className: 'hidden lg:table-cell tabular-nums', cell: (t) => t.attempts.length },
    { key: 'status', header: 'Status', cell: (t) => <div className="flex flex-wrap gap-1"><TaskStatusBadge status={t.status} />{t.overdue && <Badge variant="outline" className="border-danger-700/20 bg-danger-50 text-danger-700">Overdue</Badge>}</div> },
  ];

  return (
    <>
      <PageHeader title="Follow-ups" description="Missed care to recover. Tasks are created automatically for missed appointments and referrals, or by health workers." actions={<><OrganisationPicker />{canRun && !needsOrg && <RunCheckButton organisationId={isPlatform ? (organisationId ?? undefined) : undefined} />}</>} />
      {needsOrg ? <EmptyState icon={ClipboardList} title="Choose an organisation" /> : (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
            <Tabs value={view} onValueChange={(v) => { setView(v as View); setPage(1); }}>
              <TabsList>
                <TabsTrigger value="open">Open</TabsTrigger>
                <TabsTrigger value="overdue">Overdue</TabsTrigger>
                <TabsTrigger value="escalated">Escalated</TabsTrigger>
                <TabsTrigger value="resolved">Resolved</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex flex-1 flex-col gap-3 sm:flex-row lg:justify-end">
              <Select value={reason} onValueChange={(v) => { setReason(v as FollowUpReason | typeof ALL); setPage(1); }}>
                <SelectTrigger className="h-9 sm:w-64" aria-label="Reason"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>All reasons</SelectItem>{FOLLOW_UP_REASONS.map((r) => <SelectItem key={r} value={r}>{FOLLOW_UP_REASON_LABELS[r]}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={chw} onValueChange={(v) => { setChw(v); setPage(1); }}>
                <SelectTrigger className="h-9 sm:w-56" aria-label="Health worker"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>All health workers</SelectItem>{(chws.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.user.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DataTable columns={columns} rows={query.data?.data} rowKey={(t) => t.id} isPending={query.isPending} isFetching={query.isFetching} error={query.error} onRetry={() => query.refetch()}
            empty={{ icon: ClipboardList, title: view === 'overdue' ? 'Nothing overdue' : view === 'open' ? 'No open follow-ups' : 'Nothing here' }} meta={query.data?.meta} onPageChange={setPage} />
        </Card>
      )}
    </>
  );
}

export function FollowUpsPage() {
  return <RequirePermission permission="followup:read"><FollowUpsContent /></RequirePermission>;
}
