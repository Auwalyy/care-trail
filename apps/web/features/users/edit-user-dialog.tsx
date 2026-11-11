'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiError } from '@caretrail/api-client';
import { ROLE_REQUIREMENTS, type UserDto } from '@caretrail/shared-types';
import { nigerianPhoneSchema, objectIdSchema } from '@caretrail/validation';
import { FormField, fieldAria } from '@/components/form/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/features/auth/session-store';
import { useCommunities, useFacilities } from '@/features/directory/use-directory';
import { api } from '@/services/api';
import { applyApiErrors } from '@/components/form/apply-api-errors';
import { CommunityPicker, FacilitySelect } from './assignment-fields';
import { LANGUAGE_LABELS } from './labels';

const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  phone: z.union([z.literal(''), nigerianPhoneSchema]),
  preferredLanguage: z.enum(['en', 'ha']),
  facilityId: objectIdSchema.nullable(),
  communityIds: z.array(objectIdSchema),
});
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function EditUserDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const me = useSession((s) => s.user)!;
  const queryClient = useQueryClient();
  const facilities = useFacilities();
  const communities = useCommunities();
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema) });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (user) {
      form.reset({
        fullName: user.fullName,
        phone: user.phone ?? '',
        preferredLanguage: user.preferredLanguage,
        facilityId: user.facilityId,
        communityIds: user.communityIds,
      });
    }
  }, [user, form]);

  if (!user) return null;
  const req = ROLE_REQUIREMENTS[user.role];
  const orgFacilities = (facilities.data ?? []).filter((f) => f.organisationId === user.organisationId && f.status === 'active');
  const orgCommunities = (communities.data ?? []).filter((c) => c.organisationId === user.organisationId && c.status === 'active');

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.users.update(user.id, {
        fullName: v.fullName,
        phone: v.phone || null,
        preferredLanguage: v.preferredLanguage,
        ...(req.facility && me.role !== 'facility_admin' ? { facilityId: v.facilityId } : {}),
        ...(req.communities ? { communityIds: v.communityIds } : {}),
        version: user.version,
      });
      toast.success('User updated');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        toast.error('Someone else changed this user. The list has been refreshed — please try again.');
        await queryClient.invalidateQueries({ queryKey: ['users'] });
        onClose();
        return;
      }
      applyApiErrors(err, form.setError, ['fullName', 'phone', 'facilityId', 'communityIds']);
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <form id="edit-user" onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormField id="edit-fullName" label="Full name" error={errors.fullName?.message}>
            <Input {...fieldAria('edit-fullName', errors.fullName?.message)} {...form.register('fullName')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="edit-phone" label="Phone (optional)" error={errors.phone?.message}>
              <Input type="tel" inputMode="tel" {...fieldAria('edit-phone', errors.phone?.message)} {...form.register('phone')} />
            </FormField>
            <FormField id="edit-language" label="Language">
              <Controller
                control={form.control}
                name="preferredLanguage"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="edit-language" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(['en', 'ha'] as const).map((l) => <SelectItem key={l} value={l}>{LANGUAGE_LABELS[l]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>
          {req.facility && me.role !== 'facility_admin' && (
            <Controller
              control={form.control}
              name="facilityId"
              render={({ field }) => <FacilitySelect facilities={orgFacilities} value={field.value} onChange={field.onChange} error={errors.facilityId?.message} />}
            />
          )}
          {req.communities && (
            <Controller
              control={form.control}
              name="communityIds"
              render={({ field }) => <CommunityPicker communities={orgCommunities} value={field.value} onChange={field.onChange} error={errors.communityIds?.message} />}
            />
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="edit-user" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
