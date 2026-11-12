'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, PhoneCall, Siren, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, FOLLOW_UP_REASON_LABELS, type ContactMethod, type FollowUpTaskDto } from '@caretrail/shared-types';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { RequirePermission } from '@/features/auth/require-session';
import { useCan } from '@/features/auth/session-store';
import { formatDate } from '@/features/patients/patient-labels';
import { formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';
import { ActionDialog } from './appointment-dialogs';
import { TaskStatusBadge } from './care-labels';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex justify-between gap-4 border-b pb-3 text-sm last:border-0 last:pb-0"><dt className="text-muted-foreground">{label}</dt><dd className="text-end font-medium">{children}</dd></div>;
}

function AttemptDialog({ t, onClose }: { t: FollowUpTaskDto; onClose: () => void }) {
  const [method, setMethod] = useState<ContactMethod>('call');
  const [reached, setReached] = useState(false);
  const [response, setResponse] = useState('');
  return (
    <ActionDialog title="Record contact attempt" description={t.patient.fullName} onClose={onClose} submitLabel="Save" canSubmit
      onSubmit={async () => { await api.followUps.attempt(t.id, { method, reached, response: response || null, version: t.version }); toast.success('Attempt recorded'); }}>
      <div className="grid gap-1.5">
        <Label htmlFor="at-method">How</Label>
        <Select value={method} onValueChange={(v) => setMethod(v as ContactMethod)}>
          <SelectTrigger id="at-method" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{CONTACT_METHODS.map((m) => <SelectItem key={m} value={m}>{CONTACT_METHOD_LABELS[m]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Label className="flex items-center gap-3 font-normal"><Checkbox checked={reached} onCheckedChange={(c) => setReached(c === true)} /> Reached the patient or their household</Label>
      <div className="grid gap-1.5">
        <Label htmlFor="at-resp">What they said (optional)</Label>
        <Textarea id="at-resp" rows={3} maxLength={500} value={response} onChange={(e) => setResponse(e.target.value)} />
      </div>
    </ActionDialog>
  );
}

function ResolveDialog({ t, onClose }: { t: FollowUpTaskDto; onClose: () => void }) {
  const [outcome, setOutcome] = useState('');
  const [next, setNext] = useState('');
  return (
    <ActionDialog title="Resolve follow-up" description={t.patient.fullName} onClose={onClose} submitLabel="Resolve" canSubmit={outcome.trim().length >= 3}
      onSubmit={async () => { await api.followUps.resolve(t.id, { outcome, nextAction: next || null, version: t.version }); toast.success('Follow-up resolved'); }}>
      <div className="grid gap-1.5"><Label htmlFor="rs-out">Outcome</Label><Textarea id="rs-out" rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Rebooked for next Tuesday" /></div>
      <div className="grid gap-1.5"><Label htmlFor="rs-next">Next action (optional)</Label><Input id="rs-next" value={next} onChange={(e) => setNext(e.target.value)} /></div>
    </ActionDialog>
  );
}

function EscalateDialog({ t, onClose }: { t: FollowUpTaskDto; onClose: () => void }) {
  const [notes, setNotes] = useState('');
  return (
    <ActionDialog title="Escalate" description="Sends this to the health worker’s supervisor, or to programme administrators if none is set. Follow your programme’s escalation procedure." onClose={onClose} submitLabel="Escalate" canSubmit={notes.trim().length >= 3}
      onSubmit={async () => { await api.followUps.escalate(t.id, notes, t.version); toast.success('Escalated'); }}>
      <div className="grid gap-1.5"><Label htmlFor="es-notes">Why does this need escalation?</Label><Textarea id="es-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
    </ActionDialog>
  );
}

function DetailContent({ id }: { id: string }) {
  const canManage = useCan('followup:manage');
  const canEscalate = useCan('followup:escalate');
  const query = useQuery({ queryKey: ['follow-up', id], queryFn: () => api.followUps.get(id) });
  const [dialog, setDialog] = useState<null | 'attempt' | 'resolve' | 'escalate'>(null);
  if (query.isPending) return <Skeleton className="h-72 w-full" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const t = query.data;
  const closed = t.status === 'resolved';

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ms-2"><Link href="/follow-ups"><ArrowLeft aria-hidden /> All follow-ups</Link></Button>
      <PageHeader title={t.patient.fullName} description={FOLLOW_UP_REASON_LABELS[t.reason]}
        actions={!closed && canManage && (
          <>
            <Button className="h-9" onClick={() => setDialog('attempt')}><PhoneCall aria-hidden /> Record attempt</Button>
            <Button variant="secondary" className="h-9" onClick={() => setDialog('resolve')}><CheckCircle2 aria-hidden /> Resolve</Button>
            {canEscalate && t.status !== 'escalated' && <Button variant="outline" className="h-9" onClick={() => setDialog('escalate')}><Siren aria-hidden /> Escalate</Button>}
          </>
        )} />
      <div className="mb-6"><TaskStatusBadge status={t.status} /></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Task</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <Row label="Patient code"><span className="font-mono">{t.patient.patientCode}</span></Row>
              <Row label="Health worker">{t.assignedChw.name ?? '—'}</Row>
              <Row label="Due">{formatDate(t.dueOn)}{t.overdue && <span className="text-danger-700"> (overdue)</span>}</Row>
              {t.source.type === 'referral' && t.source.id && <Row label="Referral"><Link className="font-mono text-brand-700 hover:underline" href={`/referrals/${t.source.id}`}>{t.source.label}</Link></Row>}
              {t.source.type === 'appointment' && <Row label="Missed appointment">{formatDate(t.source.label)}</Row>}
              <Row label="Created">{formatDateTime(t.createdAt)} · {t.createdBy?.name ?? 'Automatic check'}</Row>
              {t.note && <Row label="Note">{t.note}</Row>}
              {t.outcome && <Row label="Outcome">{t.outcome}</Row>}
              {t.nextAction && <Row label="Next action">{t.nextAction}</Row>}
            </dl>
            {t.escalation && (
              <div className="mt-4 rounded-lg bg-danger-50 p-3 text-sm">
                <p className="font-medium text-danger-700">Escalated {formatDateTime(t.escalation.at)} by {t.escalation.by.name} to {t.escalation.to.map((u) => u.name).join(', ')}</p>
                <p className="mt-1">{t.escalation.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Contact attempts</CardTitle></CardHeader>
          <CardContent>
            {t.attempts.length === 0 ? <p className="text-sm text-muted-foreground">No attempts recorded yet.</p> : (
              <ol className="grid gap-3">
                {[...t.attempts].reverse().map((a, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    {a.reached ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-700" aria-label="Reached" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-label="Not reached" />}
                    <div>
                      <div className="font-medium">{CONTACT_METHOD_LABELS[a.method]} · {a.reached ? 'reached' : 'not reached'}</div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(a.at)} · {a.by.name}</div>
                      {a.response && <p className="mt-1">{a.response}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
      {dialog === 'attempt' && <AttemptDialog t={t} onClose={() => setDialog(null)} />}
      {dialog === 'resolve' && <ResolveDialog t={t} onClose={() => setDialog(null)} />}
      {dialog === 'escalate' && <EscalateDialog t={t} onClose={() => setDialog(null)} />}
    </>
  );
}

export function FollowUpDetail({ id }: { id: string }) {
  return <RequirePermission permission="followup:read"><DetailContent id={id} /></RequirePermission>;
}
