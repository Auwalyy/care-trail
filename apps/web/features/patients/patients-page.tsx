'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, UserPlus, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { CARE_PATHWAYS, CARE_PATHWAY_LABELS, PATIENT_STATUSES, PATIENT_STATUS_LABELS, type CarePathway, type PatientDto, type PatientStatus } from '@caretrail/shared-types';
import type { ListPatientsParams } from '@caretrail/api-client';
import { DataTable, type Column } from '@/components/data/data-table';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RequirePermission } from '@/features/auth/require-session';
import { useCan } from '@/features/auth/session-store';
import { useCommunities } from '@/features/directory/use-directory';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { formatDateTime } from '@/features/users/labels';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api } from '@/services/api';
import { PathwayBadge, PatientStatusBadge, ReminderConsentIcons, keyPathwayDate } from './patient-labels';
import { useActiveChws } from './use-chws';

const ALL = '__all__';

function PatientsContent() {
  const canRegister = useCan('patient:create');
  const { isPlatform, organisationId } = useActiveOrganisation();
  const communities = useCommunities();
  const chws = useActiveChws(isPlatform ? organisationId : undefined);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [community, setCommunity] = useState(ALL);
  const [chw, setChw] = useState(ALL);
  const [pathway, setPathway] = useState<CarePathway | typeof ALL>(ALL);
  const [status, setStatus] = useState<PatientStatus | typeof ALL>('active');
  const [dupOnly, setDupOnly] = useState(false);
  const q = useDebouncedValue(search.trim());
  const needsOrg = isPlatform && !organisationId;
  const reset = () => setPage(1);

  const params: ListPatientsParams = {
    page,
    pageSize: 25,
    ...(q ? { q } : {}),
    ...(community !== ALL ? { communityId: community } : {}),
    ...(chw !== ALL ? { assignedChwId: chw } : {}),
    ...(pathway !== ALL ? { carePathway: pathway } : {}),
    ...(status !== ALL ? { status } : {}),
    ...(dupOnly ? { possibleDuplicate: 'true' as const } : {}),
    ...(isPlatform && organisationId ? { organisationId } : {}),
  };
  const query = useQuery({ queryKey: ['patients', params], queryFn: () => api.patients.list(params), placeholderData: keepPreviousData, enabled: !needsOrg });
  const orgCommunities = (communities.data ?? []).filter((c) => c.organisationId === organisationId);
  const filtered = Boolean(q) || community !== ALL || chw !== ALL || pathway !== ALL || status !== 'active' || dupOnly;

  const columns: Column<PatientDto>[] = [
    {
      key: 'name',
      header: 'Patient',
      cell: (p) => (
        <Link href={`/patients/${p.id}`} className="group">
          <div className="font-medium group-hover:underline">{p.fullName}</div>
          <div className="font-mono text-xs text-muted-foreground">{p.patientCode}</div>
        </Link>
      ),
    },
    {
      key: 'pathway',
      header: 'Care pathway',
      cell: (p) => (
        <div className="grid gap-1">
          <PathwayBadge pathway={p.carePathway} />
          {keyPathwayDate(p) && <span className="text-xs text-muted-foreground">{keyPathwayDate(p)}</span>}
        </div>
      ),
    },
    { key: 'community', header: 'Community', className: 'hidden md:table-cell', cell: (p) => communities.names.get(p.communityId) ?? '—' },
    { key: 'chw', header: 'Health worker', className: 'hidden lg:table-cell', cell: (p) => p.assignedChw.name ?? '—' },
    { key: 'reminders', header: 'Reminders', className: 'hidden xl:table-cell', cell: (p) => <ReminderConsentIcons p={p} /> },
    {
      key: 'status',
      header: 'Status',
      cell: (p) => (
        <div className="grid gap-1">
          <PatientStatusBadge status={p.status} />
          {p.possibleDuplicateOf.length > 0 && <span className="text-xs text-warning-700">Possible duplicate</span>}
        </div>
      ),
    },
    { key: 'registered', header: 'Registered', className: 'hidden xl:table-cell whitespace-nowrap text-muted-foreground', cell: (p) => formatDateTime(p.createdAt) },
  ];

  return (
    <>
      <PageHeader
        title="Patients"
        description="Pregnant women, new mothers, newborns and caregivers enrolled for care coordination."
        actions={
          <>
            <OrganisationPicker />
            {canRegister && !needsOrg && (
              <Button asChild className="h-9"><Link href="/patients/new"><UserPlus aria-hidden /> Register patient</Link></Button>
            )}
          </>
        }
      />
      {needsOrg ? (
        <EmptyState icon={UsersRound} title="Choose an organisation" description="Select an organisation above to see its patients." />
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="grid gap-3 border-b p-4 md:grid-cols-2 xl:grid-cols-6">
            <div className="relative md:col-span-2">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} placeholder="Name, patient code or phone" aria-label="Search patients" className="h-9 ps-9" />
            </div>
            <Select value={community} onValueChange={(v) => { setCommunity(v); reset(); }}>
              <SelectTrigger className="h-9 w-full" aria-label="Community"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All communities</SelectItem>
                {orgCommunities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={chw} onValueChange={(v) => { setChw(v); reset(); }}>
              <SelectTrigger className="h-9 w-full" aria-label="Health worker"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All health workers</SelectItem>
                {(chws.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.user.fullName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={pathway} onValueChange={(v) => { setPathway(v as CarePathway | typeof ALL); reset(); }}>
              <SelectTrigger className="h-9 w-full" aria-label="Care pathway"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All pathways</SelectItem>
                {CARE_PATHWAYS.map((c) => <SelectItem key={c} value={c}>{CARE_PATHWAY_LABELS[c]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v as PatientStatus | typeof ALL); reset(); }}>
              <SelectTrigger className="h-9 w-full" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {PATIENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{PATIENT_STATUS_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Label className="flex h-9 items-center gap-2 font-normal md:col-span-2 xl:col-span-6">
              <Checkbox checked={dupOnly} onCheckedChange={(v) => { setDupOnly(v === true); reset(); }} />
              Only show registrations flagged as possible duplicates
            </Label>
          </div>
          <DataTable
            columns={columns}
            rows={query.data?.data}
            rowKey={(p) => p.id}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            onRetry={() => query.refetch()}
            empty={
              filtered
                ? { icon: UsersRound, title: 'No patients match these filters', description: 'Try a different search or clear some filters.' }
                : { icon: UsersRound, title: 'No patients registered yet', description: 'Community health workers register patients in the mobile app. Programme staff can also register here.' }
            }
            meta={query.data?.meta}
            onPageChange={setPage}
          />
        </Card>
      )}
    </>
  );
}

export function PatientsPage() {
  return (
    <RequirePermission permission="patient:read">
      <PatientsContent />
    </RequirePermission>
  );
}
