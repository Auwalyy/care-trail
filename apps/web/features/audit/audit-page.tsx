'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { ROLE_LABELS, isRole, type AuditLogDto } from '@caretrail/shared-types';
import type { ListAuditParams } from '@caretrail/api-client';
import { DataTable, type Column } from '@/components/data/data-table';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RequirePermission } from '@/features/auth/require-session';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';
import { ACTION_FILTERS, describeAction } from './action-labels';

const ALL = '__all__';

function metadataSummary(m: Record<string, unknown> | null): string {
  if (!m) return '';
  const parts: string[] = [];
  if (Array.isArray(m.fields) && m.fields.length) parts.push(`fields: ${(m.fields as string[]).join(', ')}`);
  if (typeof m.reason === 'string') parts.push(`reason: ${m.reason.replace(/_/g, ' ')}`);
  if (typeof m.role === 'string' && isRole(m.role)) parts.push(ROLE_LABELS[m.role]);
  if (typeof m.purpose === 'string') parts.push(m.purpose);
  if (typeof m.client === 'string') parts.push(m.client);
  return parts.join(' · ');
}

export const AUDIT_COLUMNS: Column<AuditLogDto>[] = [
  { key: 'at', header: 'When', className: 'whitespace-nowrap text-muted-foreground', cell: (l) => formatDateTime(l.at) },
  {
    key: 'action',
    header: 'Event',
    cell: (l) => (
      <div>
        <span className="font-medium">{describeAction(l.action)}</span>
        {l.outcome === 'failure' && <Badge variant="outline" className="ms-2 border-danger-700/20 bg-danger-50 text-danger-700">Failed</Badge>}
        {metadataSummary(l.metadata) && <div className="text-xs text-muted-foreground">{metadataSummary(l.metadata)}</div>}
      </div>
    ),
  },
  {
    key: 'actor',
    header: 'By',
    cell: (l) =>
      l.actor ? (
        <div>
          <div>{l.actor.name ?? 'Unknown user'}</div>
          {l.actor.role && isRole(l.actor.role) && <div className="text-xs text-muted-foreground">{ROLE_LABELS[l.actor.role]}</div>}
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

/** Paged audit entries for given filters (also embedded on the CHW detail page). */
export function AuditTable({ filters, emptyTitle }: { filters: Omit<ListAuditParams, 'page'>; emptyTitle: string }) {
  const [page, setPage] = useState(1);
  const params = { ...filters, page, pageSize: filters.pageSize ?? 25 };
  const query = useQuery({ queryKey: ['audit-logs', params], queryFn: () => api.auditLogs.list(params), placeholderData: keepPreviousData });
  return (
    <DataTable
      columns={AUDIT_COLUMNS}
      rows={query.data?.data}
      rowKey={(l) => l.id}
      isPending={query.isPending}
      isFetching={query.isFetching}
      error={query.error}
      onRetry={() => query.refetch()}
      empty={{ icon: ScrollText, title: emptyTitle }}
      meta={query.data?.meta}
      onPageChange={setPage}
    />
  );
}

function AuditContent() {
  const { isPlatform, organisationId } = useActiveOrganisation();
  const [action, setAction] = useState(ALL);
  const [outcome, setOutcome] = useState<typeof ALL | 'success' | 'failure'>(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters: Omit<ListAuditParams, 'page'> = {
    ...(action !== ALL ? { action } : {}),
    ...(outcome !== ALL ? { outcome } : {}),
    ...(from ? { from: new Date(`${from}T00:00:00`) } : {}),
    ...(to ? { to: new Date(`${to}T23:59:59`) } : {}),
    ...(isPlatform && organisationId ? { organisationId } : {}),
  };

  return (
    <>
      <PageHeader title="Audit log" description="A permanent record of sign-ins and administrative changes. Entries cannot be edited or deleted." actions={<OrganisationPicker allowAll />} />
      <Card className="gap-0 overflow-hidden p-0">
        <div className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="audit-action">Event type</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger id="audit-action" className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All events</SelectItem>
                {ACTION_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-outcome">Outcome</Label>
            <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
              <SelectTrigger id="audit-outcome" className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All outcomes</SelectItem>
                <SelectItem value="success">Succeeded</SelectItem>
                <SelectItem value="failure">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-from">From</Label>
            <Input id="audit-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-to">To</Label>
            <Input id="audit-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
        </div>
        <AuditTable key={JSON.stringify(filters)} filters={filters} emptyTitle="No audit entries match these filters" />
      </Card>
    </>
  );
}

export function AuditPage() {
  return (
    <RequirePermission permission="audit:read">
      <AuditContent />
    </RequirePermission>
  );
}
