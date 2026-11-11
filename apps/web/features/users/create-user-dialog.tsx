'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { MANAGEABLE_ROLES, ROLE_LABELS, ROLE_REQUIREMENTS, type Role } from '@caretrail/shared-types';
import { createUserSchema } from '@caretrail/validation';
import { FormField, fieldAria } from '@/components/form/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/features/auth/session-store';
import { useCommunities, useFacilities, useOrganisations } from '@/features/directory/use-directory';
import { api } from '@/services/api';
import { applyApiErrors } from './apply-api-errors';
import { CommunityPicker, FacilitySelect } from './assignment-fields';
import type { IssuedLinkInfo } from './issued-link-dialog';
import { LANGUAGE_LABELS } from './labels';

type FormInput = z.input<typeof createUserSchema>;
type FormOutput = z.output<typeof createUserSchema>;
const FIELDS = ['email', 'fullName', 'phone', 'role', 'organisationId', 'facilityId', 'communityIds'] as const;

export function CreateUserDialog({ onCreated }: { onCreated: (info: IssuedLinkInfo) => void }) {
  const me = useSession((s) => s.user)!;
  const roles = MANAGEABLE_ROLES[me.role];
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const orgs = useOrganisations();
  const facilities = useFacilities();
  const communities = useCommunities();

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', fullName: '', phone: '', role: roles[0], preferredLanguage: 'en', organisationId: null, facilityId: null, communityIds: [] },
  });
  const { errors, isSubmitting } = form.formState;
  const role = useWatch({ control: form.control, name: 'role' }) as Role;
  const chosenOrg = useWatch({ control: form.control, name: 'organisationId' });
  const req = ROLE_REQUIREMENTS[role];
  const isPlatform = me.role === 'platform_admin';
  const orgId = isPlatform ? chosenOrg : me.organisationId;
  const orgFacilities = (facilities.data ?? []).filter((f) => f.organisationId === orgId && f.status === 'active');
  const orgCommunities = (communities.data ?? []).filter((c) => c.organisationId === orgId && c.status === 'active');

  const mutation = useMutation({ mutationFn: api.users.create });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await mutation.mutateAsync({
        ...values,
        phone: values.phone || null,
        organisationId: isPlatform && req.organisation ? values.organisationId ?? null : null,
        facilityId: req.facility && me.role !== 'facility_admin' ? values.facilityId ?? null : null,
        communityIds: req.communities ? values.communityIds : [],
      });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setOpen(false);
      form.reset();
      onCreated({ link: result.activation, userName: result.user.fullName, kind: 'activation' });
    } catch (err) {
      applyApiErrors(err, form.setError, FIELDS);
    }
  });

  if (roles.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) form.reset(); }}>
      <DialogTrigger asChild>
        <Button className="h-9"><UserPlus aria-hidden /> Add user</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>The user receives an activation link to set their own password. No password is set by you.</DialogDescription>
        </DialogHeader>
        <form id="create-user" onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormField id="role" label="Role" error={errors.role?.message}>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => { field.onChange(v); form.setValue('facilityId', null); form.setValue('communityIds', []); }}>
                  <SelectTrigger id="role" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          <FormField id="fullName" label="Full name" error={errors.fullName?.message}>
            <Input autoComplete="off" {...fieldAria('fullName', errors.fullName?.message)} {...form.register('fullName')} />
          </FormField>
          <FormField id="email" label="Email" error={errors.email?.message}>
            <Input type="email" autoComplete="off" {...fieldAria('email', errors.email?.message)} {...form.register('email')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="phone" label="Phone (optional)" error={errors.phone?.message} hint="e.g. 0803 123 4567">
              <Input type="tel" inputMode="tel" autoComplete="off" {...fieldAria('phone', errors.phone?.message, true)} {...form.register('phone')} />
            </FormField>
            <FormField id="preferredLanguage" label="Language">
              <Controller
                control={form.control}
                name="preferredLanguage"
                render={({ field }) => (
                  <Select value={field.value ?? 'en'} onValueChange={field.onChange}>
                    <SelectTrigger id="preferredLanguage" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(['en', 'ha'] as const).map((l) => <SelectItem key={l} value={l}>{LANGUAGE_LABELS[l]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>

          {isPlatform && req.organisation && (
            <FormField id="organisationId" label="Organisation" error={errors.organisationId?.message}>
              <Controller
                control={form.control}
                name="organisationId"
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={(v) => { field.onChange(v); form.setValue('facilityId', null); form.setValue('communityIds', []); }}>
                    <SelectTrigger id="organisationId" className="w-full"><SelectValue placeholder="Select an organisation" /></SelectTrigger>
                    <SelectContent>
                      {(orgs.data ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          )}

          {req.facility && me.role !== 'facility_admin' && orgId && (
            <Controller
              control={form.control}
              name="facilityId"
              render={({ field }) => (
                <FacilitySelect facilities={orgFacilities} value={field.value} onChange={field.onChange} error={errors.facilityId?.message} />
              )}
            />
          )}

          {req.communities && orgId && (
            <Controller
              control={form.control}
              name="communityIds"
              render={({ field }) => (
                <CommunityPicker communities={orgCommunities} value={field.value ?? []} onChange={field.onChange} error={errors.communityIds?.message} />
              )}
            />
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" form="create-user" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            Create and get activation link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
