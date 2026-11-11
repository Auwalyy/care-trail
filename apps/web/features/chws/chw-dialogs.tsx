'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiError } from '@caretrail/api-client';
import type { ChwDto } from '@caretrail/shared-types';
import { emailSchema, nigerianPhoneSchema, objectIdSchema } from '@caretrail/validation';
import { applyApiErrors } from '@/components/form/apply-api-errors';
import { FormField, fieldAria } from '@/components/form/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCommunities } from '@/features/directory/use-directory';
import { CommunityPicker } from '@/features/users/assignment-fields';
import type { IssuedLinkInfo } from '@/features/users/issued-link-dialog';
import { LANGUAGE_LABELS } from '@/features/users/labels';
import { api } from '@/services/api';
import { ProgrammeAreasField, ReferralAuthorisationField, SupervisorField } from './chw-profile-fields';
import { parseAreas, useSupervisorCandidates } from './use-staff';

const profileShape = {
  communityIds: z.array(objectIdSchema).min(1, 'Assign at least one community'),
  programmeAreas: z.string().max(400),
  canIssueReferrals: z.boolean(),
  supervisorUserId: objectIdSchema.nullable(),
};

const createSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  email: emailSchema,
  phone: z.union([z.literal(''), nigerianPhoneSchema]),
  preferredLanguage: z.enum(['en', 'ha']),
  ...profileShape,
});
type CreateIn = z.input<typeof createSchema>;
type CreateOut = z.output<typeof createSchema>;

const PROFILE_FIELDS = ['communityIds', 'programmeAreas', 'supervisorUserId'] as const;

function useOrgCommunities(organisationId: string | null) {
  const communities = useCommunities();
  return (communities.data ?? []).filter((c) => c.organisationId === organisationId && c.status === 'active');
}

export function CreateChwDialog({
  open,
  organisationId,
  onClose,
  onCreated,
}: {
  open: boolean;
  organisationId: string | null;
  onClose: () => void;
  onCreated: (info: IssuedLinkInfo) => void;
}) {
  const qc = useQueryClient();
  const communities = useOrgCommunities(organisationId);
  const supervisors = useSupervisorCandidates(organisationId);
  const form = useForm<CreateIn, unknown, CreateOut>({ resolver: zodResolver(createSchema) });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (open) form.reset({ fullName: '', email: '', phone: '', preferredLanguage: 'ha', communityIds: [], programmeAreas: '', canIssueReferrals: false, supervisorUserId: null });
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await api.chws.create({
        ...v,
        phone: v.phone || null,
        programmeAreas: parseAreas(v.programmeAreas),
        organisationId,
      });
      await qc.invalidateQueries({ queryKey: ['chws'] });
      await qc.invalidateQueries({ queryKey: ['overview'] });
      onClose();
      onCreated({ link: res.activation, userName: res.chw.user.fullName, kind: 'activation' });
    } catch (err) {
      applyApiErrors(err, form.setError, ['fullName', 'email', 'phone', ...PROFILE_FIELDS]);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add community health worker</DialogTitle>
          <DialogDescription>They receive an activation link to set their password, then sign in on the mobile app.</DialogDescription>
        </DialogHeader>
        <form id="chw-create" onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormField id="chw-name" label="Full name" error={errors.fullName?.message}>
            <Input {...fieldAria('chw-name', errors.fullName?.message)} {...form.register('fullName')} />
          </FormField>
          <FormField id="chw-email" label="Email" error={errors.email?.message} hint="Used to sign in">
            <Input type="email" {...fieldAria('chw-email', errors.email?.message, true)} {...form.register('email')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="chw-phone" label="Phone (optional)" error={errors.phone?.message}>
              <Input type="tel" inputMode="tel" {...fieldAria('chw-phone', errors.phone?.message)} {...form.register('phone')} />
            </FormField>
            <FormField id="chw-lang" label="App language">
              <Controller
                control={form.control}
                name="preferredLanguage"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="chw-lang" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{(['ha', 'en'] as const).map((l) => <SelectItem key={l} value={l}>{LANGUAGE_LABELS[l]}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>
          <Controller control={form.control} name="communityIds" render={({ field }) => <CommunityPicker communities={communities} value={field.value} onChange={field.onChange} error={errors.communityIds?.message} />} />
          <Controller control={form.control} name="programmeAreas" render={({ field }) => <ProgrammeAreasField value={field.value} onChange={field.onChange} error={errors.programmeAreas?.message} />} />
          <Controller control={form.control} name="supervisorUserId" render={({ field }) => <SupervisorField candidates={supervisors.data ?? []} value={field.value} onChange={field.onChange} error={errors.supervisorUserId?.message} />} />
          <Controller control={form.control} name="canIssueReferrals" render={({ field }) => <ReferralAuthorisationField checked={field.value} onChange={field.onChange} />} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="chw-create" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            Create and get activation link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const editSchema = z.object(profileShape);
type EditValues = z.infer<typeof editSchema>;

export function EditChwProfileDialog({ chw, onClose }: { chw: ChwDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const orgId = chw?.user.organisationId ?? null;
  const communities = useOrgCommunities(orgId);
  const supervisors = useSupervisorCandidates(orgId);
  const form = useForm<EditValues>({ resolver: zodResolver(editSchema) });
  const { errors, isSubmitting } = form.formState;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (chw && loadedFor !== `${chw.id}:${chw.version}`) {
    setLoadedFor(`${chw.id}:${chw.version}`);
    form.reset({
      communityIds: chw.user.communityIds,
      programmeAreas: chw.programmeAreas.join(', '),
      canIssueReferrals: chw.canIssueReferrals,
      supervisorUserId: chw.supervisorUserId,
    });
  }
  if (!chw) return null;

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.chws.update(chw.id, { ...v, programmeAreas: parseAreas(v.programmeAreas), version: chw.version });
      toast.success('Profile updated');
      await qc.invalidateQueries({ queryKey: ['chws'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        toast.error('This profile was changed by someone else. It has been reloaded — please try again.');
        await qc.invalidateQueries({ queryKey: ['chws'] });
        onClose();
        return;
      }
      applyApiErrors(err, form.setError, PROFILE_FIELDS);
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit programme profile</DialogTitle>
          <DialogDescription>{chw.user.fullName}</DialogDescription>
        </DialogHeader>
        <form id="chw-edit" onSubmit={onSubmit} noValidate className="grid gap-4">
          <Controller control={form.control} name="communityIds" render={({ field }) => <CommunityPicker communities={communities} value={field.value} onChange={field.onChange} error={errors.communityIds?.message} />} />
          <Controller control={form.control} name="programmeAreas" render={({ field }) => <ProgrammeAreasField value={field.value} onChange={field.onChange} error={errors.programmeAreas?.message} />} />
          <Controller control={form.control} name="supervisorUserId" render={({ field }) => <SupervisorField candidates={supervisors.data ?? []} value={field.value} onChange={field.onChange} error={errors.supervisorUserId?.message} />} />
          <Controller control={form.control} name="canIssueReferrals" render={({ field }) => <ReferralAuthorisationField checked={field.value} onChange={field.onChange} />} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="chw-edit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
