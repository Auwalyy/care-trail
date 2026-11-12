'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarDays, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { APPOINTMENT_CATEGORY_LABELS, type AppointmentDto } from '@caretrail/shared-types';
import type { ListAppointmentsParams } from '@caretrail/api-client';
import { DataTable, type Column } from '@/components/data/data-table';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, errorMessage } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQueryClient } from '@tanstack/react-query';
import { RequirePermission } from '@/features/auth/require-session';
import { useCan, useSession } from '@/features/auth/session-store';
import { useFacilities } from '@/features/directory/use-directory';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { formatDate } from '@/features/patients/patient-labels';
import { api } from '@/services/api';
import { CancelDialog, RescheduleDialog } from './appointment-dialogs';
import { AppointmentStatusBadge, plusDaysIso } from './care-labels';

type View = 'today' | 'upcoming' | 'missed' | 'all';
const ALL = '__all__';

function viewParams(view: View): Partial<ListAppointmentsParams> {
  const today = plusDaysIso(0);
  if (view === 'today') return { from: today, to: today, status: 'scheduled,attended,missed' };
  if (view === 'upcoming') return { from: today, status: 'scheduled' };
  if (view === 'missed') return { status: 'missed', sort: '-scheduledFor' };
  return { sort: '-scheduledFor' };
}

/** Row actions for an appointment. Shared with the patient profile tab. */
export function AppointmentActions({ a }: { a: AppointmentDto }) {
  const qc = useQueryClient();
  const canAttend = useCan('appointment:record-attendance');
  const canManage = useCan('appointment:manage');
  const [dialog, setDialog] = useState<null | 'reschedule' | 'cancel'>(null);
  const open = a.status === 'scheduled' || a.status === 'missed';
  if (!open) return null;
  const attend = async (outcome: 'attended' | 'missed') => {
    try {
      await api.appointments.attendance(a.id, outcome, a.version);
      toast.success(outcome === 'attended' ? 'Attendance recorded' : 'Marked as missed — the health worker will follow up');
    } catch (err) {
      toast.error(errorMessage(err));
    }
    await Promise.all(['appointments', 'overview', 'follow-ups'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${a.patient.fullName}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canAttend && <DropdownMenuItem onSelect={() => attend('attended')}>Patient attended</DropdownMenuItem>}
          {canAttend && a.status === 'scheduled' && a.scheduledFor <= plusDaysIso(0) && <DropdownMenuItem onSelect={() => attend('missed')}>Patient did not come</DropdownMenuItem>}
          {canManage && <DropdownMenuItem onSelect={() => setDialog('reschedule')}>Reschedule</DropdownMenuItem>}
          {canManage && <DropdownMenuItem variant="destructive" onSelect={() => setDialog('cancel')}>Cancel</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === 'reschedule' && <RescheduleDialog appt={a} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelDialog appt={a} onClose={() => setDialog(null)} />}
    </>
  );
}

function AppointmentsContent() {
  const role = useSession((s) => s.user!.role);
  const isFacility = role === 'facility_admin' || role === 'facility_worker';
  const { isPlatform, organisationId } = useActiveOrganisation();
  const facilities = useFacilities();
  const [view, setView] = useState<View>(isFacility ? 'today' : 'upcoming');
  const [facility, setFacility] = useState(ALL);
  const [page, setPage] = useState(1);
  const needsOrg = isPlatform && !organisationId;
  const params: ListAppointmentsParams = { page, pageSize: 25, ...viewParams(view), ...(facility !== ALL ? { facilityId: facility } : {}), ...(isPlatform && organisationId ? { organisationId } : {}) };
  const query = useQuery({ queryKey: ['appointments', params], queryFn: () => api.appointments.list(params), placeholderData: keepPreviousData, enabled: !needsOrg });
  const orgFacilities = (facilities.data ?? []).filter((f) => f.organisationId === organisationId);

  const columns: Column<AppointmentDto>[] = [
    { key: 'date', header: 'Date', className: 'whitespace-nowrap', cell: (a) => formatDate(a.scheduledFor) },
    { key: 'patient', header: 'Patient', cell: (a) => <><div className="font-medium">{a.patient.fullName}</div><div className="font-mono text-xs text-muted-foreground">{a.patient.patientCode}</div></> },
    { key: 'type', header: 'Type', className: 'hidden md:table-cell', cell: (a) => APPOINTMENT_CATEGORY_LABELS[a.category] },
    ...(isFacility ? [] : [{ key: 'facility', header: 'Facility', className: 'hidden lg:table-cell', cell: (a: AppointmentDto) => facilities.names.get(a.facilityId) ?? '—' }]),
    { key: 'status', header: 'Status', cell: (a) => <AppointmentStatusBadge status={a.status} /> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12', cell: (a) => <AppointmentActions a={a} /> },
  ];

  return (
    <>
      <PageHeader title="Appointments" description={isFacility ? 'Appointments at your facility. Record who came so missed visits can be followed up.' : 'Antenatal, postnatal, immunisation and other appointments.'} actions={<OrganisationPicker />} />
      {needsOrg ? <EmptyState icon={CalendarDays} title="Choose an organisation" /> : (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
            <Tabs value={view} onValueChange={(v) => { setView(v as View); setPage(1); }}>
              <TabsList>
                <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="missed">Missed</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
            {!isFacility && (
              <Select value={facility} onValueChange={(v) => { setFacility(v); setPage(1); }}>
                <SelectTrigger className="h-9 lg:w-56" aria-label="Facility"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>All facilities</SelectItem>{orgFacilities.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <DataTable columns={columns} rows={query.data?.data} rowKey={(a) => a.id} isPending={query.isPending} isFetching={query.isFetching} error={query.error} onRetry={() => query.refetch()}
            empty={{ icon: CalendarDays, title: view === 'today' ? 'No appointments today' : view === 'missed' ? 'No missed appointments' : 'No appointments', description: 'Appointments are booked from a patient’s profile.' }}
            meta={query.data?.meta} onPageChange={setPage} />
        </Card>
      )}
    </>
  );
}

export function AppointmentsPage() {
  return <RequirePermission permission="appointment:read"><AppointmentsContent /></RequirePermission>;
}
