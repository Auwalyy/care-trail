'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@caretrail/api-client';
import type { PatientDto } from '@caretrail/shared-types';
import { errorMessage } from '@/components/states/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useFacilities } from '@/features/directory/use-directory';
import { api } from '@/services/api';

export function CreateReferralDialog({ patient, onClose }: { patient: PatientDto; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const facilities = useFacilities();
  const templates = useQuery({ queryKey: ['referral-templates', 'approved', patient.organisationId], queryFn: async () => (await api.referralTemplates.list({ status: 'approved', pageSize: 100, organisationId: patient.organisationId })).data });
  const [clientId] = useState(() => crypto.randomUUID());
  const [toFacilityId, setFacility] = useState('');
  const [reason, setReason] = useState('');
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const options = (facilities.data ?? []).filter((f) => f.organisationId === patient.organisationId && f.status === 'active');
  const noConsent = !patient.consent.facility_sharing?.granted;
  const inactive = patient.status !== 'active';

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const res = await api.referrals.create({ clientId, patientId: patient.id, toFacilityId, reason, instructionTemplateIds: templateIds });
      toast.success(`Referral ${res.referral.referralCode} issued`);
      await qc.invalidateQueries({ queryKey: ['referrals'] });
      await qc.invalidateQueries({ queryKey: ['patient'] });
      router.push(`/referrals/${res.referral.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path ?? '_', f.message])));
      else setErrors({ _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Refer to a facility</DialogTitle>
          <DialogDescription>{patient.fullName} · {patient.patientCode}</DialogDescription>
        </DialogHeader>
        {noConsent || inactive ? (
          <Alert variant="destructive">
            <AlertTitle>This patient cannot be referred yet</AlertTitle>
            <AlertDescription>
              {inactive
                ? 'Only active patients can be referred.'
                : 'They have not agreed to share their details with referral facilities. Record their consent on the Consent tab first.'}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-4">
            {errors._ && <Alert variant="destructive"><AlertDescription>{errors._}</AlertDescription></Alert>}
            <div className="grid gap-1.5">
              <Label htmlFor="ref-facility">Receiving facility</Label>
              <Select value={toFacilityId} onValueChange={setFacility}>
                <SelectTrigger id="ref-facility" className="w-full" aria-invalid={errors.toFacilityId ? true : undefined}><SelectValue placeholder="Choose a facility" /></SelectTrigger>
                <SelectContent>{options.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} · {f.lga}</SelectItem>)}</SelectContent>
              </Select>
              {errors.toFacilityId && <p role="alert" className="text-sm text-danger-700">{errors.toFacilityId}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ref-reason">Reason for referral</Label>
              <Textarea id="ref-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={errors.reason ? true : undefined} />
              <p className="text-sm text-muted-foreground">{errors.reason ?? 'Seen by the facility. Not printed on the patient’s receipt.'}</p>
            </div>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">Approved instructions (optional)</legend>
              {templates.data?.length ? (
                <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2">
                  {templates.data.map((t) => (
                    <Label key={t.id} className="flex cursor-pointer items-start gap-3 rounded-md p-2 font-normal hover:bg-muted">
                      <Checkbox className="mt-0.5" checked={templateIds.includes(t.id)} onCheckedChange={(c) => setTemplateIds((s) => (c === true ? [...s, t.id] : s.filter((x) => x !== t.id)))} />
                      <span><span className="block font-medium">{t.title}</span><span className="block text-xs text-muted-foreground">{t.body}</span></span>
                    </Label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No approved instructions yet. Programme staff can add them under Referral instructions.</p>
              )}
            </fieldset>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          {!noConsent && !inactive && (
            <Button onClick={submit} disabled={busy || !toFacilityId || reason.trim().length < 3}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}Issue referral
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
