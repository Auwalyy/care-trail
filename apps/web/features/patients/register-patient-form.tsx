'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '@caretrail/api-client';
import {
  CARE_PATHWAYS,
  CARE_PATHWAY_LABELS,
  CONSENT_METHODS,
  CONSENT_METHOD_LABELS,
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_LABELS,
  type DuplicateCandidate,
} from '@caretrail/shared-types';
import { registerPatientSchema } from '@caretrail/validation';
import { FormField, fieldAria } from '@/components/form/form-field';
import { PageHeader } from '@/components/layout/page-header';
import { errorMessage } from '@/components/states/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RequirePermission } from '@/features/auth/require-session';
import { useCommunities } from '@/features/directory/use-directory';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { LANGUAGE_LABELS } from '@/features/users/labels';
import { api } from '@/services/api';
import { useActiveChws } from './use-chws';

interface FormValues {
  fullName: string;
  sex: 'female' | 'male';
  ageMode: 'dob' | 'estimate';
  dateOfBirth: string;
  estimatedAge: string;
  carePathway: (typeof CARE_PATHWAYS)[number];
  expectedDeliveryDate: string;
  deliveryDate: string;
  communityId: string;
  assignedChwId: string;
  householdMode: 'none' | 'new' | 'existing';
  householdId: string;
  headName: string;
  landmark: string;
  householdPhone: string;
  phone: string;
  phoneOwner: 'self' | 'household';
  alternatePhone: string;
  preferredLanguage: 'en' | 'ha';
  preferredChannel: 'none' | 'sms' | 'voice';
  care_coordination: boolean;
  sms: boolean;
  voice: boolean;
  facility_sharing: boolean;
  consentMethod: (typeof CONSENT_METHODS)[number];
  consentTextVersion: string;
  consentLanguage: 'en' | 'ha';
  witnessName: string;
}

/** API issue path → form field. */
function fieldFor(path: string, v: FormValues): keyof FormValues | null {
  const map: Record<string, keyof FormValues> = {
    'pathwayDetails.expectedDeliveryDate': 'expectedDeliveryDate',
    'pathwayDetails.deliveryDate': 'deliveryDate',
    'household.householdId': 'householdId',
    'household.phone': 'householdPhone',
    'consent.purposes.care_coordination': 'care_coordination',
    'consent.consentTextVersion': 'consentTextVersion',
    'consent.witnessName': 'witnessName',
  };
  if (path === 'dateOfBirth' || path === 'estimatedAge') return v.ageMode === 'dob' ? 'dateOfBirth' : 'estimatedAge';
  if (map[path]) return map[path];
  return (['fullName', 'sex', 'phone', 'alternatePhone', 'communityId', 'assignedChwId', 'preferredChannel'] as const).find((k) => k === path) ?? null;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

function RegisterForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const { isPlatform, organisationId } = useActiveOrganisation();
  const communities = useCommunities();
  const chws = useActiveChws(isPlatform ? organisationId : undefined);
  const settings = useQuery({ queryKey: ['settings', isPlatform ? (organisationId ?? 'none') : 'own'], queryFn: () => api.settings.get(isPlatform ? (organisationId ?? undefined) : undefined) });
  // One id per form instance: double submits and retries can never create two patients.
  const [clientId] = useState(() => crypto.randomUUID());
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    defaultValues: {
      fullName: '', sex: 'female', ageMode: 'estimate', dateOfBirth: '', estimatedAge: '', carePathway: 'antenatal', expectedDeliveryDate: '', deliveryDate: '',
      communityId: '', assignedChwId: '', householdMode: 'none', householdId: '', headName: '', landmark: '', householdPhone: '',
      phone: '', phoneOwner: 'self', alternatePhone: '', preferredLanguage: 'ha', preferredChannel: 'none',
      care_coordination: false, sms: false, voice: false, facility_sharing: false, consentMethod: 'verbal', consentTextVersion: '', consentLanguage: 'ha', witnessName: '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const [ageMode, carePathway, communityId, householdMode] = useWatch({ control: form.control, name: ['ageMode', 'carePathway', 'communityId', 'householdMode'] });
  const households = useQuery({
    queryKey: ['households', communityId],
    enabled: Boolean(communityId) && householdMode === 'existing',
    queryFn: async () => (await api.households.list({ communityId, pageSize: 200 })).data,
  });

  // Pre-fill the consent wording version from programme settings once it loads.
  const configuredVersion = settings.data?.consentTextVersion ?? '';
  useEffect(() => {
    if (configuredVersion && !form.getValues('consentTextVersion')) form.setValue('consentTextVersion', configuredVersion);
  }, [configuredVersion, form]);

  const orgCommunities = (communities.data ?? []).filter((c) => c.organisationId === organisationId && c.status === 'active');
  const servingChws = (chws.data ?? []).filter((c) => c.user.communityIds.includes(communityId));

  const submit = async (v: FormValues, confirmNotDuplicate: boolean) => {
    setFormError(null);
    const body = {
      clientId,
      fullName: v.fullName,
      sex: v.sex,
      ...(v.ageMode === 'dob' ? { dateOfBirth: v.dateOfBirth || null } : { estimatedAge: v.estimatedAge === '' ? null : Number(v.estimatedAge) }),
      phone: v.phone || null,
      alternatePhone: v.alternatePhone || null,
      phoneOwner: v.phone ? v.phoneOwner : ('none' as const),
      communityId: v.communityId,
      household:
        v.householdMode === 'existing'
          ? { mode: 'existing' as const, householdId: v.householdId }
          : v.householdMode === 'new'
            ? { mode: 'new' as const, headName: v.headName || null, landmark: v.landmark || null, phone: v.householdPhone || null }
            : { mode: 'none' as const },
      carePathway: v.carePathway,
      pathwayDetails: { expectedDeliveryDate: v.expectedDeliveryDate || null, deliveryDate: v.deliveryDate || null },
      preferredLanguage: v.preferredLanguage,
      preferredChannel: v.preferredChannel,
      assignedChwId: v.assignedChwId || null,
      ...(isPlatform ? { organisationId } : {}),
      confirmNotDuplicate,
      consent: {
        purposes: { care_coordination: v.care_coordination, sms: v.sms, voice: v.voice, facility_sharing: v.facility_sharing },
        method: v.consentMethod,
        consentTextVersion: v.consentTextVersion,
        language: v.consentLanguage,
        witnessName: v.witnessName || null,
      },
    };

    // Same rules as the API (shared schema) — instant feedback, one source of truth.
    const check = registerPatientSchema.safeParse(body);
    if (!check.success) {
      let mapped = 0;
      for (const issue of check.error.issues) {
        const f = fieldFor(issue.path.join('.'), v);
        if (f && !form.getFieldState(f).error) {
          form.setError(f, { message: issue.message });
          mapped++;
        }
      }
      if (!v.communityId) form.setError('communityId', { message: 'Choose a community' });
      if (!mapped) setFormError(check.error.issues[0]?.message ?? 'Please check the form');
      return;
    }

    try {
      const res = await api.patients.register(body);
      await qc.invalidateQueries({ queryKey: ['patients'] });
      await qc.invalidateQueries({ queryKey: ['chws'] });
      toast.success(`${res.patient.fullName} registered as ${res.patient.patientCode}`);
      router.push(`/patients/${res.patient.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE') {
        setDuplicates((err.details as { candidates: DuplicateCandidate[] }).candidates);
        return;
      }
      if (err instanceof ApiError && err.fieldErrors.length) {
        for (const fe of err.fieldErrors) {
          const f = fe.path ? fieldFor(fe.path, v) : null;
          if (f) form.setError(f, { message: fe.message });
        }
        if (!err.fieldErrors.some((fe) => fe.path && fieldFor(fe.path, v))) setFormError(err.message);
        return;
      }
      setFormError(errorMessage(err));
    }
  };

  const onSubmit = form.handleSubmit((v) => submit(v, false));
  const e = (k: keyof FormValues) => errors[k]?.message;

  return (
    <>
      <PageHeader title="Register patient" description="Collect only what is needed to coordinate care. Read the approved consent wording to the person before saving." />
      <form onSubmit={onSubmit} noValidate className="grid max-w-3xl gap-6">
        {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}

        <Section title="Person">
          <FormField id="fullName" label="Full name" error={e('fullName')}>
            <Input autoComplete="off" {...fieldAria('fullName', e('fullName'))} {...form.register('fullName')} />
          </FormField>
          <FormField id="sex" label="Sex" error={e('sex')}>
            <Controller control={form.control} name="sex" render={({ field }) => (
              <RadioGroup id="sex" value={field.value} onValueChange={field.onChange} className="flex gap-6">
                {(['female', 'male'] as const).map((s) => <Label key={s} className="flex items-center gap-2 font-normal"><RadioGroupItem value={s} /> {s === 'female' ? 'Female' : 'Male'}</Label>)}
              </RadioGroup>
            )} />
          </FormField>
          <Controller control={form.control} name="ageMode" render={({ field }) => (
            <RadioGroup value={field.value} onValueChange={field.onChange} className="flex flex-wrap gap-6" aria-label="Age information">
              <Label className="flex items-center gap-2 font-normal"><RadioGroupItem value="estimate" /> Age is estimated</Label>
              <Label className="flex items-center gap-2 font-normal"><RadioGroupItem value="dob" /> Date of birth is known</Label>
            </RadioGroup>
          )} />
          {ageMode === 'dob' ? (
            <FormField id="dateOfBirth" label="Date of birth" error={e('dateOfBirth')}>
              <Input type="date" max={new Date().toISOString().slice(0, 10)} className="w-fit" {...fieldAria('dateOfBirth', e('dateOfBirth'))} {...form.register('dateOfBirth')} />
            </FormField>
          ) : (
            <FormField id="estimatedAge" label="Estimated age (years)" error={e('estimatedAge')}>
              <Input inputMode="numeric" className="w-32" {...fieldAria('estimatedAge', e('estimatedAge'))} {...form.register('estimatedAge')} />
            </FormField>
          )}
        </Section>

        <Section title="Care pathway" description="Coordination dates only. Do not record diagnoses or clinical findings.">
          <FormField id="carePathway" label="Pathway">
            <Controller control={form.control} name="carePathway" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="carePathway" className="w-full sm:w-72"><SelectValue /></SelectTrigger>
                <SelectContent>{CARE_PATHWAYS.map((p) => <SelectItem key={p} value={p}>{CARE_PATHWAY_LABELS[p]}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormField>
          {carePathway === 'antenatal' && (
            <FormField id="expectedDeliveryDate" label="Expected delivery date" error={e('expectedDeliveryDate')}>
              <Input type="date" className="w-fit" {...fieldAria('expectedDeliveryDate', e('expectedDeliveryDate'))} {...form.register('expectedDeliveryDate')} />
            </FormField>
          )}
          {carePathway === 'postnatal' && (
            <FormField id="deliveryDate" label="Delivery date" error={e('deliveryDate')}>
              <Input type="date" className="w-fit" max={new Date().toISOString().slice(0, 10)} {...fieldAria('deliveryDate', e('deliveryDate'))} {...form.register('deliveryDate')} />
            </FormField>
          )}
          {carePathway === 'newborn' && <p className="text-sm text-muted-foreground">Choose “Date of birth is known” above and enter the baby&apos;s date of birth.</p>}
        </Section>

        <Section title="Community and household">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="communityId" label="Community" error={e('communityId')}>
              <Controller control={form.control} name="communityId" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => { field.onChange(v); form.setValue('assignedChwId', ''); form.setValue('householdId', ''); }}>
                  <SelectTrigger id="communityId" className="w-full" aria-invalid={e('communityId') ? true : undefined}><SelectValue placeholder="Choose a community" /></SelectTrigger>
                  <SelectContent>{orgCommunities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.lga}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField id="assignedChwId" label="Responsible health worker" error={e('assignedChwId') ?? (communityId && servingChws.length === 0 ? 'No active health worker serves this community.' : undefined)}>
              <Controller control={form.control} name="assignedChwId" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={!communityId || servingChws.length === 0}>
                  <SelectTrigger id="assignedChwId" className="w-full"><SelectValue placeholder={communityId ? 'Choose a health worker' : 'Choose a community first'} /></SelectTrigger>
                  <SelectContent>{servingChws.map((c) => <SelectItem key={c.id} value={c.id}>{c.user.fullName}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </FormField>
          </div>
          <Controller control={form.control} name="householdMode" render={({ field }) => (
            <RadioGroup value={field.value} onValueChange={field.onChange} className="flex flex-wrap gap-6" aria-label="Household">
              <Label className="flex items-center gap-2 font-normal"><RadioGroupItem value="none" /> No household record</Label>
              <Label className="flex items-center gap-2 font-normal"><RadioGroupItem value="new" /> New household</Label>
              <Label className="flex items-center gap-2 font-normal"><RadioGroupItem value="existing" disabled={!communityId} /> Existing household</Label>
            </RadioGroup>
          )} />
          {householdMode === 'existing' && (
            <FormField id="householdId" label="Household" error={e('householdId') ?? (households.data?.length === 0 ? 'No households recorded in this community yet.' : undefined)}>
              <Controller control={form.control} name="householdId" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="householdId" className="w-full"><SelectValue placeholder="Choose a household" /></SelectTrigger>
                  <SelectContent>{(households.data ?? []).map((h) => <SelectItem key={h.id} value={h.id}>{h.householdCode}{h.headName ? ` · ${h.headName}` : ''}{h.landmark ? ` · ${h.landmark}` : ''}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </FormField>
          )}
          {householdMode === 'new' && (
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField id="headName" label="Head of household (optional)"><Input {...form.register('headName')} id="headName" /></FormField>
              <FormField id="landmark" label="Landmark / directions (optional)"><Input {...form.register('landmark')} id="landmark" /></FormField>
              <FormField id="householdPhone" label="Household phone (optional)" error={e('householdPhone')}><Input type="tel" inputMode="tel" {...fieldAria('householdPhone', e('householdPhone'))} {...form.register('householdPhone')} /></FormField>
            </div>
          )}
        </Section>

        <Section title="Contact and reminders" description="Reminders never contain medical details.">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="phone" label="Phone (optional)" error={e('phone')}>
              <Input type="tel" inputMode="tel" {...fieldAria('phone', e('phone'))} {...form.register('phone')} />
            </FormField>
            <FormField id="phoneOwner" label="Whose phone is it?">
              <Controller control={form.control} name="phoneOwner" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="phoneOwner" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="self">Their own</SelectItem><SelectItem value="household">Shared with the household</SelectItem></SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField id="preferredLanguage" label="Preferred language">
              <Controller control={form.control} name="preferredLanguage" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="preferredLanguage" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{(['ha', 'en'] as const).map((l) => <SelectItem key={l} value={l}>{LANGUAGE_LABELS[l]}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField id="preferredChannel" label="Reminders by" error={e('preferredChannel')}>
              <Controller control={form.control} name="preferredChannel" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="preferredChannel" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No reminders</SelectItem><SelectItem value="sms">SMS</SelectItem><SelectItem value="voice">Voice call</SelectItem></SelectContent>
                </Select>
              )} />
            </FormField>
          </div>
        </Section>

        <Section title="Consent" description="Read the programme-approved consent wording in the person's language, then record their answers.">
          <div className="grid gap-2">
            {CONSENT_PURPOSES.map((purpose) => (
              <Controller key={purpose} control={form.control} name={purpose} render={({ field }) => (
                <Label className="flex items-center gap-3 rounded-lg border p-3 font-normal">
                  <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} aria-invalid={purpose === 'care_coordination' && e('care_coordination') ? true : undefined} />
                  {CONSENT_PURPOSE_LABELS[purpose]}
                </Label>
              )} />
            ))}
            {e('care_coordination') && <p role="alert" className="text-sm text-danger-700">{e('care_coordination')}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="consentMethod" label="How consent was given">
              <Controller control={form.control} name="consentMethod" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="consentMethod" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{CONSENT_METHODS.map((m) => <SelectItem key={m} value={m}>{CONSENT_METHOD_LABELS[m]}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField id="consentLanguage" label="Language the wording was read in">
              <Controller control={form.control} name="consentLanguage" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="consentLanguage" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{(['ha', 'en'] as const).map((l) => <SelectItem key={l} value={l}>{LANGUAGE_LABELS[l]}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField id="consentTextVersion" label="Consent wording version" error={e('consentTextVersion')} hint={configuredVersion ? 'From programme settings' : 'Set a default in Programme settings'}>
              <Input {...fieldAria('consentTextVersion', e('consentTextVersion'), true)} {...form.register('consentTextVersion')} />
            </FormField>
            <FormField id="witnessName" label="Witness (optional)" error={e('witnessName')}>
              <Input {...fieldAria('witnessName', e('witnessName'))} {...form.register('witnessName')} />
            </FormField>
          </div>
        </Section>

        <div className="flex justify-end gap-3">
          <Button asChild variant="outline" className="h-10"><Link href="/patients">Cancel</Link></Button>
          <Button type="submit" className="h-10" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            Register patient
          </Button>
        </div>
      </form>

      <Dialog open={duplicates !== null} onOpenChange={(o) => !o && setDuplicates(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-warning-700" aria-hidden /> Possibly already registered</DialogTitle>
            <DialogDescription>Someone with a similar name and age is already registered in this community. Check before creating a second record.</DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2">
            {(duplicates ?? []).map((d) => (
              <li key={d.id} className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{d.fullName} <span className="font-mono text-xs text-muted-foreground">{d.patientCode}</span></div>
                <div className="text-muted-foreground">Born around {d.birthYear} · {d.assignedChwName ?? 'Unknown health worker'}</div>
                <Link href={`/patients/${d.id}`} className="text-sm font-medium text-brand-700 hover:underline">Open this record</Link>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicates(null)}>Go back</Button>
            <Button
              variant="secondary"
              disabled={isSubmitting}
              onClick={form.handleSubmit(async (v) => {
                setDuplicates(null);
                await submit(v, true);
              })}
            >
              It&apos;s a different person — register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RegisterPatientPage() {
  return (
    <RequirePermission permission="patient:create">
      <RegisterForm />
    </RequirePermission>
  );
}
