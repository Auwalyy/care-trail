'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReferralDto } from '@caretrail/shared-types';
import { DataTable, type Column } from '@/components/data/data-table';
import { Card } from '@/components/ui/card';
import { useFacilities } from '@/features/directory/use-directory';
import { formatDate } from '@/features/patients/patient-labels';
import { formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';
import { ReferralFlags, ReferralStatusBadge } from './referral-labels';

/** A patient's referrals (newest first), shown on the patient profile. */
export function PatientReferrals({ patientId }: { patientId: string }) {
  const facilities = useFacilities();
  const query = useQuery({ queryKey: ['referrals', 'patient', patientId], queryFn: () => api.referrals.list({ patientId, pageSize: 50 }) });
  const columns: Column<ReferralDto>[] = [
    { key: 'code', header: 'Referral', cell: (r) => <Link href={`/referrals/${r.id}`} className="font-mono font-medium hover:underline">{r.referralCode}</Link> },
    { key: 'to', header: 'To', cell: (r) => facilities.names.get(r.toFacilityId) ?? '—' },
    { key: 'issued', header: 'Issued', className: 'hidden md:table-cell whitespace-nowrap', cell: (r) => formatDateTime(r.issuedAt) },
    { key: 'expected', header: 'Expected by', className: 'hidden lg:table-cell', cell: (r) => formatDate(r.expectedArrivalBy) },
    { key: 'status', header: 'Status', cell: (r) => <div className="flex flex-wrap gap-1"><ReferralStatusBadge status={r.status} /><ReferralFlags r={r} /></div> },
  ];
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(r) => r.id}
        isPending={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        empty={{ icon: ArrowRightLeft, title: 'No referrals yet' }}
      />
    </Card>
  );
}
