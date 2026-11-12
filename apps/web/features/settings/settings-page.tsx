'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Loader2, Settings2, Wand2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiError } from '@caretrail/api-client';
import { PROPOSED_PILOT_TARGETS, type ProgrammeSettingsDto } from '@caretrail/shared-types';
import { applyApiErrors } from '@/components/form/apply-api-errors';
import { FormField, fieldAria } from '@/components/form/form-field';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/states/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { RequirePermission } from '@/features/auth/require-session';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';

/** Empty input = not set. */
const optionalCount = (max: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= max), `Enter a whole number from 1 to ${max}, or leave blank`)
    .transform((v) => (v === '' ? null : Number(v)));
const requiredDays = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max, `Enter a whole number from ${min} to ${max}`)
    .transform(Number);

const schema = z.object({
  communities: optionalCount(1_000),
  facilities: optionalCount(1_000),
  chws: optionalCount(10_000),
  patients: optionalCount(1_000_000),
  durationWeeks: optionalCount(520),
  startDate: z.string(),
  referralExpectedArrivalDays: requiredDays(1, 60),
  appointmentOverdueGraceDays: requiredDays(0, 14),
  offlineSessionGraceDays: requiredDays(1, 60),
  consentTextVersion: z.string().trim().max(40, 'Use at most 40 characters'),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

const str = (n: number | null) => (n === null ? '' : String(n));
function toForm(s: ProgrammeSettingsDto): FormIn {
  return {
    communities: str(s.pilot.communities),
    facilities: str(s.pilot.facilities),
    chws: str(s.pilot.chws),
    patients: str(s.pilot.patients),
    durationWeeks: str(s.pilot.durationWeeks),
    startDate: s.pilot.startDate ?? '',
    referralExpectedArrivalDays: String(s.referralExpectedArrivalDays),
    appointmentOverdueGraceDays: String(s.appointmentOverdueGraceDays),
    offlineSessionGraceDays: String(s.offlineSessionGraceDays),
    consentTextVersion: s.consentTextVersion ?? '',
  };
}

const PILOT_FIELDS = [
  ['communities', 'Communities'],
  ['facilities', 'Facilities'],
  ['chws', 'Community health workers'],
  ['patients', 'Women and newborns enrolled'],
  ['durationWeeks', 'Duration (weeks)'],
] as const;

function SettingsForm({ settings, organisationId }: { settings: ProgrammeSettingsDto; organisationId: string | undefined }) {
  const qc = useQueryClient();
  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(schema), defaultValues: toForm(settings) });
  const { errors, isSubmitting, isDirty } = form.formState;

  const fillProposed = () => {
    for (const [k] of PILOT_FIELDS) form.setValue(k, String(PROPOSED_PILOT_TARGETS[k]), { shouldDirty: true });
  };

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const saved = await api.settings.save(
        {
          pilot: { communities: v.communities, facilities: v.facilities, chws: v.chws, patients: v.patients, durationWeeks: v.durationWeeks, startDate: v.startDate || null },
          referralExpectedArrivalDays: v.referralExpectedArrivalDays,
          appointmentOverdueGraceDays: v.appointmentOverdueGraceDays,
          offlineSessionGraceDays: v.offlineSessionGraceDays,
          consentTextVersion: v.consentTextVersion || null,
          version: settings.version,
        },
        organisationId,
      );
      qc.setQueryData(['settings', organisationId ?? 'own'], saved);
      await qc.invalidateQueries({ queryKey: ['overview'] });
      form.reset(toForm(saved));
      toast.success('Settings saved');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        toast.error('Someone else saved these settings. The latest values have been loaded.');
        await qc.invalidateQueries({ queryKey: ['settings'] });
        return;
      }
      applyApiErrors(err, form.setError, []);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      {!settings.configured && (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>Not configured yet</AlertTitle>
          <AlertDescription>Default operational values are shown below. Pilot targets are left blank until you set them.</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pilot targets</CardTitle>
          <CardDescription>
            Used to track progress on the dashboard. Leave blank if not agreed. The programme design proposes 2 communities, 2 facilities,
            10 health workers and 200 women over 12 weeks. These are proposals, not confirmed deployments.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PILOT_FIELDS.map(([key, label]) => (
              <FormField key={key} id={`pilot-${key}`} label={label} error={errors[key]?.message}>
                <Input inputMode="numeric" {...fieldAria(`pilot-${key}`, errors[key]?.message)} {...form.register(key)} />
              </FormField>
            ))}
            <FormField id="pilot-start" label="Start date" error={errors.startDate?.message}>
              <Input type="date" {...fieldAria('pilot-start', errors.startDate?.message)} {...form.register('startDate')} />
            </FormField>
          </div>
          <Button type="button" variant="outline" className="w-fit" onClick={fillProposed}>
            <Wand2 aria-hidden /> Fill in the proposed pilot targets
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operational rules</CardTitle>
          <CardDescription>These drive follow-up task generation and offline access. Agree them with your clinical and programme leads.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <FormField id="referralExpectedArrivalDays" label="Referral arrival window (days)" error={errors.referralExpectedArrivalDays?.message} hint="After this, an unconfirmed referral becomes a follow-up task.">
            <Input inputMode="numeric" {...fieldAria('referralExpectedArrivalDays', errors.referralExpectedArrivalDays?.message, true)} {...form.register('referralExpectedArrivalDays')} />
          </FormField>
          <FormField id="appointmentOverdueGraceDays" label="Missed appointment after (days)" error={errors.appointmentOverdueGraceDays?.message} hint="Days after the appointment date before it counts as missed.">
            <Input inputMode="numeric" {...fieldAria('appointmentOverdueGraceDays', errors.appointmentOverdueGraceDays?.message, true)} {...form.register('appointmentOverdueGraceDays')} />
          </FormField>
          <FormField id="offlineSessionGraceDays" label="Offline access limit (days)" error={errors.offlineSessionGraceDays?.message} hint="How long the CHW app can be used without signing in online.">
            <Input inputMode="numeric" {...fieldAria('offlineSessionGraceDays', errors.offlineSessionGraceDays?.message, true)} {...form.register('offlineSessionGraceDays')} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consent wording</CardTitle>
          <CardDescription>
            The approved English and Hausa consent wording is owned by your programme and clinical leads. Enter its version reference here,
            for example “KN-2026-v1”. It is recorded with every consent so you can show which wording each person heard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormField id="consentTextVersion" label="Current consent wording version" error={errors.consentTextVersion?.message}>
            <Input className="sm:w-64" {...fieldAria('consentTextVersion', errors.consentTextVersion?.message)} {...form.register('consentTextVersion')} />
          </FormField>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{settings.updatedAt ? `Last saved ${formatDateTime(settings.updatedAt)}` : 'Never saved'}</p>
        <Button type="submit" className="h-10" disabled={isSubmitting || (!isDirty && settings.configured)}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          Save settings
        </Button>
      </div>
    </form>
  );
}

function SettingsContent() {
  const { isPlatform, organisationId } = useActiveOrganisation();
  const orgParam = isPlatform ? (organisationId ?? undefined) : undefined;
  const needsOrg = isPlatform && !organisationId;
  const query = useQuery({ queryKey: ['settings', orgParam ?? 'own'], queryFn: () => api.settings.get(orgParam), enabled: !needsOrg });

  return (
    <>
      <PageHeader title="Programme settings" description="Configure pilot targets and operational rules without changing any code." actions={<OrganisationPicker />} />
      {needsOrg ? (
        <EmptyState icon={Settings2} title="Choose an organisation" description="Settings are configured per organisation." />
      ) : query.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <SettingsForm key={`${query.data.organisationId}:${query.data.version}`} settings={query.data} organisationId={orgParam} />
      )}
    </>
  );
}

export function SettingsPage() {
  return (
    <RequirePermission permission="settings:manage">
      <SettingsContent />
    </RequirePermission>
  );
}
