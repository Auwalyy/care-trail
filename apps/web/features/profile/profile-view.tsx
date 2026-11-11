'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Smartphone } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiError } from '@caretrail/api-client';
import { ROLE_LABELS } from '@caretrail/shared-types';
import { passwordSchema } from '@caretrail/validation';
import { FormField, fieldAria } from '@/components/form/form-field';
import { PageHeader } from '@/components/layout/page-header';
import { errorMessage } from '@/components/states/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSession } from '@/features/auth/session-store';
import { LANGUAGE_LABELS, formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';

const schema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: 'New password must be different', path: ['newPassword'] });
type FormValues = z.infer<typeof schema>;

function ChangePasswordCard() {
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const session = await api.auth.changePassword(v.currentPassword, v.newPassword);
      useSession.getState().setSession(session);
      form.reset();
      toast.success('Password changed. Other devices have been signed out.');
    } catch (err) {
      const field = err instanceof ApiError ? err.fieldErrors.find((f) => f.path === 'currentPassword') : undefined;
      if (field) form.setError('currentPassword', { message: field.message });
      else toast.error(errorMessage(err));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Change password</CardTitle>
        <CardDescription>You stay signed in here; every other device is signed out.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid max-w-sm gap-4">
          <FormField id="currentPassword" label="Current password" error={errors.currentPassword?.message}>
            <Input type="password" autoComplete="current-password" {...fieldAria('currentPassword', errors.currentPassword?.message)} {...form.register('currentPassword')} />
          </FormField>
          <FormField id="newPassword" label="New password" error={errors.newPassword?.message} hint="At least 10 characters.">
            <Input type="password" autoComplete="new-password" {...fieldAria('newPassword', errors.newPassword?.message, true)} {...form.register('newPassword')} />
          </FormField>
          <FormField id="confirm" label="Confirm new password" error={errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" {...fieldAria('confirm', errors.confirm?.message)} {...form.register('confirm')} />
          </FormField>
          <Button type="submit" className="h-10 w-fit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function ProfileView() {
  const user = useSession((s) => s.user)!;
  const rows: [string, string][] = [
    ['Name', user.fullName],
    ['Email', user.email],
    ['Phone', user.phone ?? '—'],
    ['Role', ROLE_LABELS[user.role]],
    ['Language', LANGUAGE_LABELS[user.preferredLanguage]],
    ['Last sign-in', formatDateTime(user.lastLoginAt)],
  ];

  return (
    <>
      <PageHeader title="My profile" />
      {user.role === 'chw' && (
        <Alert className="mb-6 border-teal-600/30 bg-teal-50">
          <Smartphone className="text-teal-700" aria-hidden />
          <AlertTitle>Use the CARETRAIL mobile app for your community work</AlertTitle>
          <AlertDescription>Patient registration, visits, referrals and follow-ups are done in the mobile app, which works offline.</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account details</CardTitle>
            <CardDescription>Contact your administrator to change these.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate text-end font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <ChangePasswordCard />
      </div>
    </>
  );
}
