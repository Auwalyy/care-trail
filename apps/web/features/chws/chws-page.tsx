'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { HeartHandshake, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ChwDto, UserStatus } from '@caretrail/shared-types';
import type { ListChwsParams } from '@caretrail/api-client';
import { DataTable, type Column } from '@/components/data/data-table';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RequirePermission } from '@/features/auth/require-session';
import { useCan } from '@/features/auth/session-store';
import { useCommunities } from '@/features/directory/use-directory';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { IssuedLinkDialog, type IssuedLinkInfo } from '@/features/users/issued-link-dialog';
import { STATUS_BADGE, STATUS_LABELS, formatDateTime } from '@/features/users/labels';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api } from '@/services/api';
import { ChwActions } from './chw-actions';
import { CreateChwDialog, EditChwProfileDialog } from './chw-dialogs';

const ALL = '__all__';

export function SyncStatus({ chw }: { chw: ChwDto }) {
  if (!chw.device.lastSyncAt) return <span className="text-muted-foreground">Not yet synced</span>;
  return (
    <span>
      {formatDateTime(chw.device.lastSyncAt)}
      {chw.device.pendingOperations ? <span className="text-warning-700"> · {chw.device.pendingOperations} pending</span> : null}
    </span>
  );
}

function ChwsContent() {
  const canManage = useCan('chw:manage');
  const { isPlatform, organisationId } = useActiveOrganisation();
  const communities = useCommunities();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [community, setCommunity] = useState(ALL);
  const [status, setStatus] = useState<UserStatus | typeof ALL>(ALL);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ChwDto | null>(null);
  const [issued, setIssued] = useState<IssuedLinkInfo | null>(null);
  const q = useDebouncedValue(search.trim());
  const needsOrg = isPlatform && !organisationId;

  const params: ListChwsParams = {
    page,
    pageSize: 25,
    ...(q ? { q } : {}),
    ...(community !== ALL ? { communityId: community } : {}),
    ...(status !== ALL ? { status } : {}),
    ...(isPlatform && organisationId ? { organisationId } : {}),
  };
  const query = useQuery({ queryKey: ['chws', params], queryFn: () => api.chws.list(params), placeholderData: keepPreviousData, enabled: !needsOrg });
  const orgCommunities = (communities.data ?? []).filter((c) => c.organisationId === organisationId);

  const columns: Column<ChwDto>[] = [
    {
      key: 'name',
      header: 'Health worker',
      cell: (c) => (
        <Link href={`/chws/${c.id}`} className="group">
          <div className="font-medium group-hover:underline">{c.user.fullName}</div>
          <div className="text-xs text-muted-foreground">{c.user.email}</div>
        </Link>
      ),
    },
    { key: 'communities', header: 'Communities', className: 'hidden md:table-cell max-w-56 truncate', cell: (c) => c.user.communityIds.map((id) => communities.names.get(id) ?? '—').join(', ') },
    { key: 'patients', header: 'Patients', className: 'hidden md:table-cell tabular-nums', cell: (c) => c.assignedPatients },
    {
      key: 'referrals',
      header: 'Referrals',
      className: 'hidden lg:table-cell',
      cell: (c) => (c.canIssueReferrals ? <Badge variant="outline" className="border-teal-600/30 bg-teal-50 text-teal-700">Authorised</Badge> : <span className="text-muted-foreground">Not authorised</span>),
    },
    { key: 'status', header: 'Account', cell: (c) => <Badge variant="outline" className={STATUS_BADGE[c.user.status]}>{STATUS_LABELS[c.user.status]}</Badge> },
    { key: 'sync', header: 'Last sync', className: 'hidden xl:table-cell whitespace-nowrap', cell: (c) => <SyncStatus chw={c} /> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12', cell: (c) => <ChwActions chw={c} onEdit={() => setEditing(c)} onLinkIssued={setIssued} /> },
  ];

  return (
    <>
      <PageHeader
        title="Community health workers"
        description="Health workers who register patients, visit households and follow up on missed care."
        actions={
          <>
            <OrganisationPicker />
            {canManage && !needsOrg && <Button className="h-9" onClick={() => setCreating(true)}><Plus aria-hidden /> Add health worker</Button>}
          </>
        }
      />
      {needsOrg ? (
        <EmptyState icon={HeartHandshake} title="Choose an organisation" description="Select an organisation above to see its health workers." />
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by name or email" aria-label="Search health workers" className="h-9 ps-9" />
            </div>
            <Select value={community} onValueChange={(v) => { setCommunity(v); setPage(1); }}>
              <SelectTrigger className="h-9 sm:w-52" aria-label="Filter by community"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All communities</SelectItem>
                {orgCommunities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v as UserStatus | typeof ALL); setPage(1); }}>
              <SelectTrigger className="h-9 sm:w-48" aria-label="Filter by account status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All accounts</SelectItem>
                {(['active', 'pending_activation', 'inactive'] as const).map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DataTable
            columns={columns}
            rows={query.data?.data}
            rowKey={(c) => c.id}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            onRetry={() => query.refetch()}
            empty={
              q || community !== ALL || status !== ALL
                ? { icon: HeartHandshake, title: 'No health workers match these filters' }
                : { icon: HeartHandshake, title: 'No health workers yet', ...(canManage ? { description: 'Add the community health workers taking part in the programme.' } : {}) }
            }
            meta={query.data?.meta}
            onPageChange={setPage}
          />
        </Card>
      )}
      <CreateChwDialog open={creating} organisationId={organisationId} onClose={() => setCreating(false)} onCreated={setIssued} />
      <EditChwProfileDialog chw={editing} onClose={() => setEditing(null)} />
      <IssuedLinkDialog info={issued} onClose={() => setIssued(null)} />
    </>
  );
}

export function ChwsPage() {
  return (
    <RequirePermission permission="chw:read">
      <ChwsContent />
    </RequirePermission>
  );
}
