'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { APPOINTMENT_CATEGORY_LABELS, type AppointmentDto } from '@caretrail/shared-types';
import { DataTable, type Column } from '@/components/data/data-table';
import { Card } from '@/components/ui/card';
import { useFacilities } from '@/features/directory/use-directory';
import { formatDate } from '@/features/patients/patient-labels';
import { api } from '@/services/api';
import { AppointmentActions } from './appointments-page';
import { AppointmentStatusBadge } from './care-labels';

export function PatientAppointments({ patientId }: { patientId: string }) {
  const facilities = useFacilities();
  const query = useQuery({ queryKey: ['appointments', 'patient', patientId], queryFn: () => api.appointments.list({ patientId, pageSize: 50, sort: '-scheduledFor' }) });
  const columns: Column<AppointmentDto>[] = [
    { key: 'date', header: 'Date', cell: (a) => formatDate(a.scheduledFor) },
    { key: 'type', header: 'Type', cell: (a) => APPOINTMENT_CATEGORY_LABELS[a.category] },
    { key: 'facility', header: 'Facility', className: 'hidden md:table-cell', cell: (a) => facilities.names.get(a.facilityId) ?? '—' },
    { key: 'status', header: 'Status', cell: (a) => <AppointmentStatusBadge status={a.status} /> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12', cell: (a) => <AppointmentActions a={a} /> },
  ];
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <DataTable columns={columns} rows={query.data?.data} rowKey={(a) => a.id} isPending={query.isPending} error={query.error} onRetry={() => query.refetch()} empty={{ icon: CalendarDays, title: 'No appointments yet' }} />
    </Card>
  );
}
