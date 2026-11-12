'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, ScanLine, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ReferralDto } from '@caretrail/shared-types';
import type { ListReferralsParams } from '@caretrail/api-client';
import { DataTable, type Column } from '@/components/data/data-table';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RequirePermission } from '@/features/auth/require-session';
import { useCan, useSession } from '@/features/auth/session-store';
import { useFacilities } from '@/features/directory/use-directory';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { formatDate } from '@/features/patients/patient-labels';
import { formatDateTime } from '@/features/users/labels';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api } from '@/services/api';
import { ReferralFlags, ReferralStatusBadge } from './referral-labels';

type View = 'open' | 'overdue' | 'closed' | 'all';
const ALL = '__all__';
const VIEW_PARAMS: Record<View, Partial<ListReferralsParams>> = {
  open: { open: 'true', sort: 'expectedArrivalBy' },
  overdue: { overdue: 'true', sort: 'expectedArrivalBy' },
  closed: { status: 'completed,cancelled' },
  all: {},
};

function ReferralsContent() {
  const role = useSession((s) => s.user!.role);
  const isFacility = role === 'facility_admin' || role === 'facility_worker';
  const canVerify = useCan('referral:verify');
  const { isPlatform, organisationId } = useActiveOrganisation();
  const facilities = useFacilities();
  const [view, setView] = useState<View>('open');
  const [facility, setFacility] = useState(ALL);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim());
  const needsOrg = isPlatform && !organisationId;

  const params: ListReferralsParams = {
    page,
    pageSize: 25,
    ...VIEW_PARAMS[view],
    ...(q ? { q } : {}),
    ...(facility !== ALL ? { toFacilityId: facility } : {}),
    ...(isPlatform && organisationId ? { organisationId } : {}),
  };
  const query = useQuery({ queryKey: ['referrals', params], queryFn: () => api.referrals.list(params), placeholderData: keepPreviousData, enabled: !needsOrg, refetchInterval: isFacility ? 30_000 : false });
  const orgFacilities = (facilities.data ?? []).filter((f) => f.organisationId === organisationId);

  const columns: Column<ReferralDto>[] = [
    {
      key: 'code',
      header: 'Referral',
      cell: (r) => (
        <Link href={`/referrals/${r.id}`} className="group">
          <div className="font-mono font-medium group-hover:underline">{r.referralCode}</div>
          <div className="text-xs text-muted-foreground">{formatDateTime(r.issuedAt)}</div>
        </Link>
      ),
    },
    { key: 'patient', header: 'Patient', cell: (r) => <><div className="font-medium">{r.patient.fullName}</div><div className="font-mono text-xs text-muted-foreground">{r.patient.patientCode}</div></> },
    ...(isFacility ? [] : [{ key: 'facility', header: 'To facility', className: 'hidden md:table-cell', cell: (r: ReferralDto) => facilities.names.get(r.toFacilityId) ?? '—' }]),
    { key: 'expected', header: 'Expected by', className: 'hidden lg:table-cell whitespace-nowrap', cell: (r) => formatDate(r.expectedArrivalBy) },
    { key: 'issuer', header: 'Issued by', className: 'hidden xl:table-cell', cell: (r) => r.issuedBy.name ?? '—' },
    { key: 'status', header: 'Status', cell: (r) => <div className="flex flex-wrap gap-1"><ReferralStatusBadge status={r.status} /><ReferralFlags r={r} /></div> },
  ];

  return (
    <>
      <PageHeader
        title={isFacility ? 'Incoming referrals' : 'Referrals'}
        description={isFacility ? 'Patients referred to your facility. Confirm arrival and record the outcome to close each referral.' : 'Referrals issued in your programme and their progress.'}
        actions={
          <>
            <OrganisationPicker />
            {canVerify && <Button asChild className="h-9"><Link href="/referrals/verify"><ScanLine aria-hidden /> Verify a referral code</Link></Button>}
          </>
        }
      />
      {needsOrg ? (
        <EmptyState icon={ArrowRightLeft} title="Choose an organisation" />
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
            <Tabs value={view} onValueChange={(v) => { setView(v as View); setPage(1); }}>
              <TabsList>
                <TabsTrigger value="open">Open</TabsTrigger>
                <TabsTrigger value="overdue">Not yet arrived</TabsTrigger>
                <TabsTrigger value="closed">Closed</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Referral code" aria-label="Search by referral code" className="h-9 ps-9 font-mono uppercase" />
            </div>
            {!isFacility && (
              <Select value={facility} onValueChange={(v) => { setFacility(v); setPage(1); }}>
                <SelectTrigger className="h-9 lg:w-56" aria-label="Receiving facility"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All facilities</SelectItem>
                  {orgFacilities.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <DataTable
            columns={columns}
            rows={query.data?.data}
            rowKey={(r) => r.id}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            onRetry={() => query.refetch()}
            empty={{
              icon: ArrowRightLeft,
              title: view === 'overdue' ? 'No referrals are past their expected arrival date' : view === 'open' ? 'No open referrals' : 'No referrals found',
              ...(view === 'open' && !isFacility ? { description: 'Referrals are issued from a patient’s profile.' } : {}),
            }}
            meta={query.data?.meta}
            onPageChange={setPage}
          />
        </Card>
      )}
    </>
  );
}

export function ReferralsPage() {
  return (
    <RequirePermission permission="referral:read">
      <ReferralsContent />
    </RequirePermission>
  );
}
