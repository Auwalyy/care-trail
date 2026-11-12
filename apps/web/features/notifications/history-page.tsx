'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare, Play } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_STATUS_LABELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TEMPLATES,
  type NotificationDto,
  type NotificationStatus,
} from '@caretrail/shared-types';
import { DataTable, type Column } from '@/components/data/data-table';
import { PageHeader } from '@/components/layout/page-header';
import { errorMessage } from '@/components/states/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RequirePermission, useHasPermission } from '@/features/auth/require-session';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';

const TONE: Partial<Record<NotificationStatus, string>> = {
  sent: 'border-success-700/20 bg-success-50 text-success-700',
  delivered: 'border-success-700/20 bg-success-50 text-success-700',
  failed: 'border-danger-700/20 bg-danger-50 text-danger-700',
  blocked_no_consent: 'border-warning-700/20 bg-warning-50 text-warning-700',
  not_sent_no_provider: 'border-warning-700/20 bg-warning-50 text-warning-700',
};

function HistoryContent() {
  const qc = useQueryClient();
  const canRun = useHasPermission('settings:manage');
  const { isPlatform, organisationId } = useActiveOrganisation();
  const [status, setStatus] = useState<NotificationStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [running, setRunning] = useState(false);
  const params = { page, pageSize: 25, ...(status !== 'all' ? { status } : {}), ...(isPlatform && organisationId ? { organisationId } : {}) };
  const query = useQuery({ queryKey: ['notification-history', params], queryFn: () => api.notifications.history(params), placeholderData: keepPreviousData });

  const columns: Column<NotificationDto>[] = [
    { key: 'what', header: 'Message', cell: (n) => <><div className="font-medium">{NOTIFICATION_TEMPLATES[n.templateKey].label}</div><div className="text-xs text-muted-foreground">{NOTIFICATION_CHANNEL_LABELS[n.channel]} · {n.language === 'ha' ? 'Hausa' : 'English'}</div></> },
    { key: 'to', header: 'Recipient', cell: (n) => <span className="font-mono text-sm">{n.recipient.label ?? '—'}</span> },
    { key: 'status', header: 'Status', cell: (n) => <><Badge variant="outline" className={TONE[n.status] ?? ''}>{NOTIFICATION_STATUS_LABELS[n.status]}</Badge>{n.lastError && n.status !== 'sent' && <div className="mt-1 max-w-xs text-xs text-muted-foreground">{n.lastError}</div>}</> },
    { key: 'when', header: 'Created', className: 'hidden md:table-cell whitespace-nowrap', cell: (n) => <><div className="text-sm">{formatDateTime(n.createdAt)}</div><div className="text-xs text-muted-foreground">{n.createdBy ? `by ${n.createdBy.name ?? 'staff'}` : 'automatic'}{n.attempts > 1 ? ` · ${n.attempts} attempts` : ''}</div></> },
  ];

  return (
    <>
      <PageHeader
        title="SMS & voice reminders"
        description="Every reminder sent to patients, or why it was not sent. Phone numbers and message text are not shown here."
        actions={
          <>
            <OrganisationPicker />
            {canRun && (
              <Button
                variant="outline"
                className="h-9"
                disabled={running}
                onClick={async () => {
                  setRunning(true);
                  try {
                    const r = await api.notifications.runDispatch();
                    toast.success(`Planned ${r.remindersPlanned}, sent ${r.sent}, not sent ${r.notSent + r.blocked}, failed ${r.failed}`);
                    await qc.invalidateQueries({ queryKey: ['notification-history'] });
                  } catch (err) {
                    toast.error(errorMessage(err));
                  } finally {
                    setRunning(false);
                  }
                }}
              >
                {running ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />} Send due now
              </Button>
            )}
          </>
        }
      />
      <Alert className="mb-4">
        <AlertDescription>
          Messages are only sent to patients who consented to that channel, and contain no medical details. Until an SMS or voice provider is configured on the server, reminders are recorded as “not sent”.
        </AlertDescription>
      </Alert>
      <Card className="gap-0 overflow-hidden p-0">
        <div className="border-b p-4">
          <Select value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(1); }}>
            <SelectTrigger className="w-64" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {NOTIFICATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{NOTIFICATION_STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DataTable
          columns={columns}
          rows={query.data?.data}
          rowKey={(n) => n.id}
          isPending={query.isPending}
          isFetching={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          empty={{ icon: MessageSquare, title: 'No reminders yet', description: 'Send one from an appointment or referral, or switch on day-before reminders in Programme settings.' }}
          meta={query.data?.meta}
          onPageChange={setPage}
        />
      </Card>
    </>
  );
}

export function NotificationHistoryPage() {
  return (
    <RequirePermission permission="notification:send">
      <HistoryContent />
    </RequirePermission>
  );
}
