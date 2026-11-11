'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { passwordSchema } from '@caretrail/validation';
import { FormField, fieldAria } from '@/components/form/form-field';
import { errorMessage } from '@/components/states/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type FormValues = z.infer<typeof schema>;

/** Completes account activation (mode=activate) or a password reset from a one-time link. */
export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token');
  const activating = params.get('mode') === 'activate';
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    if (!token) return;
    setSubmitError(null);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setSubmitError(errorMessage(err));
    }
  });

  if (!token) {
    return (
      <div className="grid gap-4">
        <h1 className="text-xl font-semibold">Link incomplete</h1>
        <p className="text-sm text-muted-foreground">
          This link is missing its code. Open the full link you were given, or ask your administrator for a new one.
        </p>
        <Link href="/login" className="text-sm font-medium text-brand-700 hover:underline">Back to sign in</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="grid gap-4 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success-700" aria-hidden />
        <h1 className="text-xl font-semibold">{activating ? 'Your account is ready' : 'Password updated'}</h1>
        <p className="text-sm text-muted-foreground">
          {activating
            ? 'You can now sign in. Community health workers sign in on the CARETRAIL mobile app.'
            : 'You have been signed out everywhere else. Sign in with your new password.'}
        </p>
        <Button asChild size="lg" className="h-10">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{activating ? 'Activate your account' : 'Choose a new password'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Use at least 10 characters. A short sentence you can remember works well.
        </p>
      </div>
      {submitError && (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}
      <FormField id="password" label="New password" error={errors.password?.message}>
        <Input type="password" autoComplete="new-password" autoFocus {...fieldAria('password', errors.password?.message)} {...form.register('password')} />
      </FormField>
      <FormField id="confirm" label="Confirm password" error={errors.confirm?.message}>
        <Input type="password" autoComplete="new-password" {...fieldAria('confirm', errors.confirm?.message)} {...form.register('confirm')} />
      </FormField>
      <Button type="submit" size="lg" className="h-10 w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
        {activating ? 'Activate account' : 'Update password'}
      </Button>
    </form>
  );
}
