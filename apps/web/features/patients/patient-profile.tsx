'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRightLeft, CalendarPlus, CheckCircle2, ClipboardCheck, History, MoreHorizontal, Pencil, RefreshCw, UserCog, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  CARE_PATHWAY_LABELS,
  CONSENT_METHOD_LABELS,
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_LABELS,
  type PatientDto,
} from '@caretrail/shared-types';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RequirePermission } from '@/features/auth/require-session';
import { useCan } from '@/features/auth/session-store';
import { useCommunities } from '@/features/directory/use-directory';
import { LANGUAGE_LABELS, formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';
import { BookAppointmentDialog } from '@/features/care/appointment-dialogs';
import { PatientAppointments } from '@/features/care/patient-appointments';
import { CreateReferralDialog } from '@/features/referrals/create-referral-dialog';
import { PatientReferrals } from '@/features/referrals/patient-referrals';
import { EditPatientDialog, ReassignDialog, RecordConsentDialog, StatusDialog } from './patient-dialogs';
import { PathwayBadge, PatientStatusBadge, describeAge, formatDate } from './patient-labels';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-3 text-sm last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{children}</dd>
    </div>
  );
}

function Overview({ p }: { p: PatientDto }) {
  const communities = useCommunities();
  const household = useQuery({ queryKey: ['patient', 'household', p.householdId], enabled: Boolean(p.householdId), queryFn: () => api.households.get(p.householdId!) });
  const others = (household.data?.members ?? []).filter((m) => m.id !== p.id);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Person</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3">
            <Row label="Sex">{p.sex === 'female' ? 'Female' : 'Male'}</Row>
            <Row label="Age">{describeAge(p)}</Row>
            <Row label="Language">{LANGUAGE_LABELS[p.preferredLanguage]}</Row>
            <Row label="Phone">{p.phone ?? '—'}{p.phone && p.phoneOwner === 'household' && <span className="text-muted-foreground"> (household)</span>}</Row>
            <Row label="Alternate phone">{p.alternatePhone ?? '—'}</Row>
            <Row label="Reminders">{p.preferredChannel === 'none' ? 'None' : p.preferredChannel === 'sms' ? 'SMS' : 'Voice call'}</Row>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Care coordination</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3">
            <Row label="Pathway">{CARE_PATHWAY_LABELS[p.carePathway]}</Row>
            {p.carePathway === 'antenatal' && <Row label="Expected delivery">{formatDate(p.pathwayDetails.expectedDeliveryDate)}</Row>}
            {p.carePathway === 'postnatal' && <Row label="Delivered">{formatDate(p.pathwayDetails.deliveryDate)}</Row>}
            {p.pathwayDetails.motherPatientId && <Row label="Mother"><Link href={`/patients/${p.pathwayDetails.motherPatientId}`} className="text-brand-700 hover:underline">Open record</Link></Row>}
            <Row label="Community">{communities.names.get(p.communityId) ?? '—'}</Row>
            <Row label="Health worker">{p.assignedChw.name ?? '—'}</Row>
            <Row label="Household">{household.data ? `${household.data.householdCode}${household.data.landmark ? ` · ${household.data.landmark}` : ''}` : p.householdId ? '…' : 'Not recorded'}</Row>
            {others.length > 0 && (
              <Row label="Also in household">
                {others.map((m, i) => (
                  <span key={m.id}>{i > 0 && ', '}<Link href={`/patients/${m.id}`} className="text-brand-700 hover:underline">{m.fullName}</Link></span>
                ))}
              </Row>
            )}
            <Row label="Registered">{formatDateTime(p.createdAt)}</Row>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function ConsentTab({ p, onRecord, canRecord }: { p: PatientDto; onRecord: () => void; canRecord: boolean }) {
  const history = useQuery({ queryKey: ['patient', 'consent', p.id], queryFn: () => api.patients.consentHistory(p.id) });
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Current consent</CardTitle>
          {canRecord && <Button variant="outline" size="sm" onClick={onRecord}><ClipboardCheck aria-hidden /> Record consent</Button>}
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2">
            {CONSENT_PURPOSES.map((k) => {
              const c = p.consent[k];
              return (
                <li key={k} className="flex items-center gap-3 text-sm">
                  {c?.granted ? <CheckCircle2 className="size-5 text-success-700" aria-label="Granted" /> : <XCircle className="size-5 text-ink-subtle" aria-label="Not granted" />}
                  <span className="flex-1">{CONSENT_PURPOSE_LABELS[k]}</span>
                  <span className="text-xs text-muted-foreground">{c ? formatDateTime(c.recordedAt) : 'Never asked'}</span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      <Card className="gap-0 overflow-hidden p-0">
        <CardHeader className="border-b py-4"><CardTitle className="text-base">Consent records</CardTitle></CardHeader>
        {history.isPending ? <TableSkeleton rows={2} /> : history.isError ? <ErrorState error={history.error} onRetry={() => history.refetch()} /> : (
          <ol className="divide-y">
            {history.data.map((r) => (
              <li key={r.id} className="grid gap-1 p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{formatDateTime(r.recordedAt)}</span>
                  <span className="text-muted-foreground">{CONSENT_METHOD_LABELS[r.method]} · {LANGUAGE_LABELS[r.language]} · wording {r.consentTextVersion}</span>
                </div>
                <div>Granted: {CONSENT_PURPOSES.filter((k) => r.purposes[k]).map((k) => CONSENT_PURPOSE_LABELS[k].replace(' (required)', '')).join(', ') || 'none'}</div>
                <div className="text-xs text-muted-foreground">Recorded by {r.recordedBy.name ?? 'unknown'}{r.witnessName ? ` · witness ${r.witnessName}` : ''}</div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function HistoryTab({ p }: { p: PatientDto }) {
  const timeline = useQuery({ queryKey: ['patient', 'history', p.id], queryFn: () => api.patients.history(p.id) });
  if (timeline.isPending) return <TableSkeleton rows={3} cols={2} />;
  if (timeline.isError) return <ErrorState error={timeline.error} onRetry={() => timeline.refetch()} />;
  if (!timeline.data.length) return <EmptyState icon={History} title="No history yet" />;
  return (
    <Card>
      <CardContent>
        <ol className="relative grid gap-5 border-s ps-6">
          {timeline.data.map((e, i) => (
            <li key={i} className="relative">
              <span className="absolute -start-[1.95rem] top-1 size-3 rounded-full border-2 border-background bg-brand-600" aria-hidden />
              <div className="text-sm font-medium">{e.summary}</div>
              <div className="text-xs text-muted-foreground">{formatDateTime(e.at)}{e.actor?.name ? ` · ${e.actor.name}` : ''}</div>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-xs text-muted-foreground">Referrals, appointments and follow-ups will appear here as those features are used.</p>
      </CardContent>
    </Card>
  );
}

function ProfileContent({ id }: { id: string }) {
  const canUpdate = useCan('patient:update');
  const canReassign = useCan('patient:reassign');
  const canConsent = useCan('consent:record');
  const canRefer = useCan('referral:create');
  const canSeeReferrals = useCan('referral:read');
  const canBook = useCan('appointment:manage');
  const canSeeAppointments = useCan('appointment:read');
  const query = useQuery({ queryKey: ['patient', id], queryFn: () => api.patients.get(id), staleTime: 0, refetchOnWindowFocus: false }); // each fetch is an audited view
  const [dialog, setDialog] = useState<null | 'edit' | 'status' | 'reassign' | 'consent' | 'refer' | 'book'>(null);

  if (query.isPending) return <Skeleton className="h-72 w-full" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const p = query.data;
  const close = () => setDialog(null);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ms-2"><Link href="/patients"><ArrowLeft aria-hidden /> All patients</Link></Button>
      <PageHeader
        title={p.fullName}
        description={p.patientCode}
        actions={
          <>
          {canBook && p.status === 'active' && <Button variant="outline" className="h-9" onClick={() => setDialog('book')}><CalendarPlus aria-hidden /> Book appointment</Button>}
          {canRefer && <Button className="h-9" onClick={() => setDialog('refer')}><ArrowRightLeft aria-hidden /> Refer to a facility</Button>}
          {(canUpdate || canReassign) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" className="h-9"><MoreHorizontal aria-hidden /> Actions</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canUpdate && <DropdownMenuItem onSelect={() => setDialog('edit')}><Pencil aria-hidden /> Edit details</DropdownMenuItem>}
                {canUpdate && <DropdownMenuItem onSelect={() => setDialog('status')}><RefreshCw aria-hidden /> Change status</DropdownMenuItem>}
                {canReassign && <DropdownMenuItem onSelect={() => setDialog('reassign')}><UserCog aria-hidden /> Reassign health worker</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          </>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <PathwayBadge pathway={p.carePathway} />
        <PatientStatusBadge status={p.status} />
      </div>
      {p.status !== 'active' && p.statusReason && (
        <Alert className="mb-6"><AlertTitle>Not active</AlertTitle><AlertDescription>{p.statusReason}</AlertDescription></Alert>
      )}
      {p.possibleDuplicateOf.length > 0 && (
        <Alert className="mb-6 border-warning-700/30 bg-warning-50">
          <AlertTitle>Registered despite a possible-duplicate warning</AlertTitle>
          <AlertDescription>
            Check whether this is the same person as{' '}
            {p.possibleDuplicateOf.map((d, i) => <span key={d}>{i > 0 && ', '}<Link href={`/patients/${d}`} className="font-medium underline">this record</Link></span>)}.
          </AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="consent">Consent</TabsTrigger>
          {canSeeReferrals && <TabsTrigger value="referrals">Referrals</TabsTrigger>}
          {canSeeAppointments && <TabsTrigger value="appointments">Appointments</TabsTrigger>}
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview p={p} /></TabsContent>
        <TabsContent value="consent"><ConsentTab p={p} canRecord={canConsent} onRecord={() => setDialog('consent')} /></TabsContent>
        {canSeeReferrals && <TabsContent value="referrals"><PatientReferrals patientId={p.id} /></TabsContent>}
        {canSeeAppointments && <TabsContent value="appointments"><PatientAppointments patientId={p.id} /></TabsContent>}
        <TabsContent value="history"><HistoryTab p={p} /></TabsContent>
      </Tabs>
      {/* Keyed on version so each dialog opens with the latest saved values. */}
      {dialog === 'edit' && <EditPatientDialog key={p.version} patient={p} open onClose={close} />}
      {dialog === 'status' && <StatusDialog key={p.version} patient={p} open onClose={close} />}
      {dialog === 'reassign' && <ReassignDialog key={p.version} patient={p} open onClose={close} />}
      {dialog === 'consent' && <RecordConsentDialog key={p.version} patient={p} open onClose={close} />}
      {dialog === 'refer' && <CreateReferralDialog patient={p} onClose={close} />}
      {dialog === 'book' && <BookAppointmentDialog patientId={p.id} organisationId={p.organisationId} patientName={p.fullName} onClose={close} />}
    </>
  );
}

export function PatientProfile({ id }: { id: string }) {
  return (
    <RequirePermission permission="patient:read">
      <ProfileContent id={id} />
    </RequirePermission>
  );
}
