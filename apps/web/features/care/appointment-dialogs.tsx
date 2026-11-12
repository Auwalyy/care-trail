'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@caretrail/api-client';
import { APPOINTMENT_CATEGORIES, APPOINTMENT_CATEGORY_LABELS, type AppointmentCategory, type AppointmentDto } from '@caretrail/shared-types';
import { errorMessage } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/features/auth/session-store';
import { useFacilities } from '@/features/directory/use-directory';
import { api } from '@/services/api';
import { plusDaysIso } from './care-labels';

/** Small dialog shell: run an action, show field or general errors, refresh on success. */
export function ActionDialog({ title, description, onClose, onSubmit, canSubmit, submitLabel, children }: { title: string; description?: ReactNode; onClose: () => void; onSubmit: () => Promise<void>; canSubmit: boolean; submitLabel: string; children: ReactNode }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      await Promise.all(['appointments', 'follow-ups', 'follow-up', 'overview', 'patient'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        toast.error('This was changed by someone else. The latest version has been loaded.');
        await Promise.all(['appointments', 'follow-ups', 'follow-up'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
        onClose();
      } else setError(err instanceof ApiError && err.fieldErrors[0] ? err.fieldErrors[0].message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-4">{children}</div>
        {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Back</Button>
          <Button onClick={run} disabled={busy || !canSubmit}>{busy && <Loader2 className="animate-spin" aria-hidden />}{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BookAppointmentDialog({ patientId, organisationId, patientName, onClose }: { patientId: string; organisationId: string; patientName: string; onClose: () => void }) {
  const role = useSession((s) => s.user!.role);
  const isFacility = role === 'facility_admin' || role === 'facility_worker';
  const facilities = useFacilities();
  const [clientId] = useState(() => crypto.randomUUID());
  const [facilityId, setFacility] = useState('');
  const [category, setCategory] = useState<AppointmentCategory>('antenatal');
  const [date, setDate] = useState(plusDaysIso(7));
  const options = (facilities.data ?? []).filter((f) => f.organisationId === organisationId && f.status === 'active');
  return (
    <ActionDialog
      title="Book appointment"
      description={patientName}
      onClose={onClose}
      submitLabel="Book"
      canSubmit={Boolean(date) && (isFacility || Boolean(facilityId))}
      onSubmit={async () => {
        await api.appointments.create({ clientId, patientId, category, scheduledFor: date, ...(isFacility ? {} : { facilityId }) });
        toast.success('Appointment booked');
      }}
    >
      {!isFacility && (
        <div className="grid gap-1.5">
          <Label htmlFor="ap-fac">Facility</Label>
          <Select value={facilityId} onValueChange={setFacility}>
            <SelectTrigger id="ap-fac" className="w-full"><SelectValue placeholder="Choose a facility" /></SelectTrigger>
            <SelectContent>{options.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="ap-cat">Type</Label>
        <Select value={category} onValueChange={(v) => setCategory(v as AppointmentCategory)}>
          <SelectTrigger id="ap-cat" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{APPOINTMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{APPOINTMENT_CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ap-date">Date</Label>
        <Input id="ap-date" type="date" className="w-fit" min={plusDaysIso(0)} max={plusDaysIso(365)} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
    </ActionDialog>
  );
}

export function RescheduleDialog({ appt, onClose }: { appt: AppointmentDto; onClose: () => void }) {
  const [date, setDate] = useState(plusDaysIso(7));
  return (
    <ActionDialog title="Reschedule appointment" description={appt.patient.fullName} onClose={onClose} submitLabel="Reschedule" canSubmit={Boolean(date)}
      onSubmit={async () => { await api.appointments.reschedule(appt.id, date, appt.version); toast.success('Appointment rescheduled'); }}>
      <div className="grid gap-1.5">
        <Label htmlFor="rs-date">New date</Label>
        <Input id="rs-date" type="date" className="w-fit" min={plusDaysIso(0)} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
    </ActionDialog>
  );
}

export function CancelDialog({ appt, onClose }: { appt: AppointmentDto; onClose: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <ActionDialog title="Cancel appointment" description={appt.patient.fullName} onClose={onClose} submitLabel="Cancel appointment" canSubmit={reason.trim().length >= 3}
      onSubmit={async () => { await api.appointments.cancel(appt.id, reason, appt.version); toast.success('Appointment cancelled'); }}>
      <div className="grid gap-1.5">
        <Label htmlFor="cn-reason">Reason</Label>
        <Textarea id="cn-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </ActionDialog>
  );
}
