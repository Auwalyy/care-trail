'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@caretrail/api-client';
import {
  CARE_PATHWAYS,
  CARE_PATHWAY_LABELS,
  CONSENT_METHODS,
  CONSENT_METHOD_LABELS,
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_LABELS,
  PATIENT_STATUSES,
  PATIENT_STATUS_LABELS,
  type ConsentPurpose,
  type PatientDto,
  type PatientStatus,
} from '@caretrail/shared-types';
import { errorMessage } from '@/components/states/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LANGUAGE_LABELS } from '@/features/users/labels';
import { api } from '@/services/api';
import { useActiveChws } from './use-chws';

type Fields = Record<string, string>;

/** Shared shell: runs the save, maps field errors, handles version conflicts. */
function PatientDialog({
  title,
  description,
  open,
  onClose,
  onSave,
  children,
  saveLabel = 'Save',
  errors,
  setErrors,
  canSave = true,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  onSave: () => Promise<void>;
  children: ReactNode;
  saveLabel?: string;
  errors: Fields;
  setErrors: (e: Fields) => void;
  canSave?: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await onSave();
      await qc.invalidateQueries({ queryKey: ['patients'] });
      await qc.invalidateQueries({ queryKey: ['patient'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        toast.error('This record was changed by someone else. It has been reloaded — please try again.');
        await qc.invalidateQueries({ queryKey: ['patient'] });
        onClose();
      } else if (err instanceof ApiError && err.fieldErrors.length) {
        setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path ?? '_', f.message])));
      } else {
        setErrors({ _: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {errors._ && <Alert variant="destructive"><AlertDescription>{errors._}</AlertDescription></Alert>}
        <div className="grid gap-4">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !canSave}>{busy && <Loader2 className="animate-spin" aria-hidden />}{saveLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string | undefined; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
    </div>
  );
}

export function EditPatientDialog({ patient, open, onClose }: { patient: PatientDto; open: boolean; onClose: () => void }) {
  const [errors, setErrors] = useState<Fields>({});
  const [v, setV] = useState(() => ({
    fullName: patient.fullName,
    phone: patient.phone ?? '',
    alternatePhone: patient.alternatePhone ?? '',
    preferredLanguage: patient.preferredLanguage,
    preferredChannel: patient.preferredChannel,
    carePathway: patient.carePathway,
    expectedDeliveryDate: patient.pathwayDetails.expectedDeliveryDate ?? '',
    deliveryDate: patient.pathwayDetails.deliveryDate ?? '',
  }));
  const set = (k: keyof typeof v) => (value: string) => setV((s) => ({ ...s, [k]: value }));

  return (
    <PatientDialog
      title="Edit details"
      description={`${patient.fullName} · ${patient.patientCode}`}
      open={open}
      onClose={onClose}
      errors={errors}
      setErrors={setErrors}
      onSave={async () => {
        await api.patients.update(patient.id, {
          fullName: v.fullName,
          phone: v.phone || null,
          alternatePhone: v.alternatePhone || null,
          preferredLanguage: v.preferredLanguage,
          preferredChannel: v.preferredChannel,
          carePathway: v.carePathway,
          pathwayDetails: { expectedDeliveryDate: v.expectedDeliveryDate || null, deliveryDate: v.deliveryDate || null },
          version: patient.version,
        });
        toast.success('Details updated');
      }}
    >
      <Field id="e-name" label="Full name" error={errors.fullName}><Input id="e-name" value={v.fullName} onChange={(e) => set('fullName')(e.target.value)} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="e-phone" label="Phone" error={errors.phone}><Input id="e-phone" type="tel" value={v.phone} onChange={(e) => set('phone')(e.target.value)} /></Field>
        <Field id="e-alt" label="Alternate phone" error={errors.alternatePhone}><Input id="e-alt" type="tel" value={v.alternatePhone} onChange={(e) => set('alternatePhone')(e.target.value)} /></Field>
        <Field id="e-lang" label="Language">
          <Select value={v.preferredLanguage} onValueChange={set('preferredLanguage')}>
            <SelectTrigger id="e-lang" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{(['ha', 'en'] as const).map((l) => <SelectItem key={l} value={l}>{LANGUAGE_LABELS[l]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field id="e-channel" label="Reminders by" error={errors.preferredChannel}>
          <Select value={v.preferredChannel} onValueChange={set('preferredChannel')}>
            <SelectTrigger id="e-channel" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No reminders</SelectItem>
              <SelectItem value="sms" disabled={!patient.consent.sms?.granted}>SMS{!patient.consent.sms?.granted && ' (no consent)'}</SelectItem>
              <SelectItem value="voice" disabled={!patient.consent.voice?.granted}>Voice call{!patient.consent.voice?.granted && ' (no consent)'}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field id="e-pathway" label="Care pathway" error={errors.sex ?? errors.dateOfBirth}>
        <Select value={v.carePathway} onValueChange={set('carePathway')}>
          <SelectTrigger id="e-pathway" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{CARE_PATHWAYS.map((p) => <SelectItem key={p} value={p}>{CARE_PATHWAY_LABELS[p]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      {v.carePathway === 'antenatal' && (
        <Field id="e-edd" label="Expected delivery date" error={errors['pathwayDetails.expectedDeliveryDate']}>
          <Input id="e-edd" type="date" className="w-fit" value={v.expectedDeliveryDate} onChange={(e) => set('expectedDeliveryDate')(e.target.value)} />
        </Field>
      )}
      {v.carePathway === 'postnatal' && (
        <Field id="e-dd" label="Delivery date" error={errors['pathwayDetails.deliveryDate']}>
          <Input id="e-dd" type="date" className="w-fit" value={v.deliveryDate} onChange={(e) => set('deliveryDate')(e.target.value)} />
        </Field>
      )}
    </PatientDialog>
  );
}

export function StatusDialog({ patient, open, onClose }: { patient: PatientDto; open: boolean; onClose: () => void }) {
  const [errors, setErrors] = useState<Fields>({});
  const [status, setStatus] = useState<PatientStatus>(patient.status === 'active' ? 'completed' : 'active');
  const [reason, setReason] = useState('');
  return (
    <PatientDialog
      title="Change status"
      description="The reason is kept on the record for the care team. It is not written to the audit log."
      open={open}
      onClose={onClose}
      errors={errors}
      setErrors={setErrors}
      onSave={async () => {
        await api.patients.setStatus(patient.id, { status, reason: reason || null, version: patient.version });
        toast.success(`Status changed to ${PATIENT_STATUS_LABELS[status]}`);
      }}
    >
      <Field id="s-status" label="New status">
        <Select value={status} onValueChange={(s) => setStatus(s as PatientStatus)}>
          <SelectTrigger id="s-status" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{PATIENT_STATUSES.filter((s) => s !== patient.status).map((s) => <SelectItem key={s} value={s}>{PATIENT_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      {status !== 'active' && (
        <Field id="s-reason" label="Reason" error={errors.reason}>
          <Textarea id="s-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Moved to another state" />
        </Field>
      )}
    </PatientDialog>
  );
}

export function ReassignDialog({ patient, open, onClose }: { patient: PatientDto; open: boolean; onClose: () => void }) {
  const [errors, setErrors] = useState<Fields>({});
  const chws = useActiveChws(patient.organisationId);
  const candidates = (chws.data ?? []).filter((c) => c.user.communityIds.includes(patient.communityId) && c.id !== patient.assignedChw.id);
  const [chwId, setChwId] = useState('');
  return (
    <PatientDialog
      title="Assign to another health worker"
      description={`Currently: ${patient.assignedChw.name ?? 'unknown'}. Only health workers serving this patient's community are listed.`}
      open={open}
      onClose={onClose}
      saveLabel="Reassign"
      canSave={Boolean(chwId)}
      errors={errors}
      setErrors={setErrors}
      onSave={async () => {
        await api.patients.reassign(patient.id, chwId, patient.version);
        toast.success('Patient reassigned');
      }}
    >
      <Field id="r-chw" label="Health worker" error={errors.assignedChwId ?? (candidates.length === 0 ? 'No other active health worker serves this community.' : undefined)}>
        <Select value={chwId} onValueChange={setChwId} disabled={candidates.length === 0}>
          <SelectTrigger id="r-chw" className="w-full"><SelectValue placeholder="Choose a health worker" /></SelectTrigger>
          <SelectContent>{candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.user.fullName} · {c.assignedPatients} patients</SelectItem>)}</SelectContent>
        </Select>
      </Field>
    </PatientDialog>
  );
}

export function RecordConsentDialog({ patient, open, onClose }: { patient: PatientDto; open: boolean; onClose: () => void }) {
  const [errors, setErrors] = useState<Fields>({});
  const settings = useQuery({ queryKey: ['settings', patient.organisationId], queryFn: () => api.settings.get(patient.organisationId), retry: false });
  const [purposes, setPurposes] = useState<Record<ConsentPurpose, boolean>>(() =>
    Object.fromEntries(CONSENT_PURPOSES.map((p) => [p, patient.consent[p]?.granted ?? false])) as Record<ConsentPurpose, boolean>,
  );
  const [method, setMethod] = useState<(typeof CONSENT_METHODS)[number]>('verbal');
  const [language, setLanguage] = useState<'en' | 'ha'>(patient.preferredLanguage);
  const [textVersion, setTextVersion] = useState('');
  const [witness, setWitness] = useState('');
  const version = textVersion || settings.data?.consentTextVersion || '';
  const withdrawingCare = patient.consent.care_coordination?.granted && !purposes.care_coordination;

  return (
    <PatientDialog
      title="Record consent"
      description="Read the approved wording again and record the person's answer for every purpose. A new record is added; earlier ones are kept."
      open={open}
      onClose={onClose}
      saveLabel="Save consent"
      errors={errors}
      setErrors={setErrors}
      onSave={async () => {
        await api.patients.recordConsent(patient.id, { purposes, method, language, consentTextVersion: version, witnessName: witness || null, version: patient.version });
        toast.success('Consent recorded');
      }}
    >
      <div className="grid gap-2">
        {CONSENT_PURPOSES.map((p) => (
          <Label key={p} className="flex items-center gap-3 rounded-lg border p-3 font-normal">
            <Checkbox checked={purposes[p]} onCheckedChange={(c) => setPurposes((s) => ({ ...s, [p]: c === true }))} />
            {CONSENT_PURPOSE_LABELS[p]}
          </Label>
        ))}
      </div>
      {withdrawingCare && (
        <Alert variant="destructive"><AlertDescription>Withdrawing consent to care coordination makes this record inactive. No further follow-up will be coordinated.</AlertDescription></Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="c-method" label="How consent was given">
          <Select value={method} onValueChange={(m) => setMethod(m as typeof method)}>
            <SelectTrigger id="c-method" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{CONSENT_METHODS.map((m) => <SelectItem key={m} value={m}>{CONSENT_METHOD_LABELS[m]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field id="c-lang" label="Language">
          <Select value={language} onValueChange={(l) => setLanguage(l as 'en' | 'ha')}>
            <SelectTrigger id="c-lang" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{(['ha', 'en'] as const).map((l) => <SelectItem key={l} value={l}>{LANGUAGE_LABELS[l]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field id="c-version" label="Consent wording version" error={errors.consentTextVersion}>
          <Input id="c-version" value={version} onChange={(e) => setTextVersion(e.target.value)} />
        </Field>
        <Field id="c-witness" label="Witness (optional)"><Input id="c-witness" value={witness} onChange={(e) => setWitness(e.target.value)} /></Field>
      </div>
    </PatientDialog>
  );
}
