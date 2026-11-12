'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { ErrorState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RequirePermission } from '@/features/auth/require-session';
import { useFacilities } from '@/features/directory/use-directory';
import { formatDate } from '@/features/patients/patient-labels';
import { api } from '@/services/api';

/**
 * Printable receipt the patient takes to the facility. Deliberately excludes the referral reason:
 * the paper leaves the health system and may be seen by others (decision A30).
 */
function Receipt({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['referral', id], queryFn: () => api.referrals.get(id) });
  const facilities = useFacilities();
  if (query.isPending) return <Skeleton className="mx-auto h-96 w-full max-w-md" />;
  if (query.isError) return <ErrorState error={query.error} />;
  const r = query.data;
  const facility = facilities.data?.find((f) => f.id === r.toFacilityId);

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-4 flex justify-end print:hidden">
        <Button onClick={() => window.print()}><Printer aria-hidden /> Print</Button>
      </div>
      <article className="rounded-xl border-2 border-dashed border-ink-subtle bg-white p-6 text-ink print:border-solid">
        <header className="flex items-center justify-between border-b pb-4">
          <Logo />
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Referral receipt</span>
        </header>
        <div className="my-6 text-center">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Show this code at the facility</p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-widest">{r.referralCode}</p>
        </div>
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-ink-muted">Name</dt><dd className="font-medium">{r.patient.fullName}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-muted">Patient code</dt><dd className="font-mono">{r.patient.patientCode}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-muted">Go to</dt><dd className="text-end font-medium">{facility?.name ?? '—'}</dd></div>
          {facility?.address && <div className="flex justify-between gap-4"><dt className="text-ink-muted">Address</dt><dd className="text-end">{facility.address}</dd></div>}
          <div className="flex justify-between gap-4"><dt className="text-ink-muted">Issued</dt><dd>{formatDate(r.issuedAt.slice(0, 10))}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-muted">Please go by</dt><dd className="font-semibold">{formatDate(r.expectedArrivalBy)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-muted">Health worker</dt><dd>{r.issuedBy.name ?? '—'}</dd></div>
        </dl>
        {r.instructions.length > 0 && (
          <section className="mt-6 border-t pt-4">
            <h2 className="text-sm font-semibold">Instructions</h2>
            <ul className="mt-2 grid gap-3 text-sm">
              {r.instructions.map((i) => (
                <li key={i.templateId}>
                  <p className="font-medium">{i.title}</p>
                  <p>{i.body}</p>
                  {i.bodyHa && <p lang="ha" className="text-ink-muted">{i.bodyHa}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <footer className="mt-6 border-t pt-3 text-center text-[11px] text-ink-muted">
          Keep this receipt. If you cannot go, tell your community health worker.
        </footer>
      </article>
    </div>
  );
}

export function ReferralReceipt({ id }: { id: string }) {
  return (
    <RequirePermission permission="referral:read">
      <Receipt id={id} />
    </RequirePermission>
  );
}
