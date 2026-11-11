'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { forgotPasswordSchema } from '@caretrail/validation';
import { FormField, fieldAria } from '@/components/form/form-field';
import { errorMessage } from '@/components/states/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';

type FormInput = z.input<typeof forgotPasswordSchema>;
type FormOutput = z.output<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setSubmitError(null);
    try {
      await api.auth.forgotPassword(email);
      setDone(true);
    } catch (err) {
      setSubmitError(errorMessage(err));
    }
  });

  if (done) {
    return (
      <div className="grid gap-4 text-center">
        <MailCheck className="mx-auto size-10 text-teal-600" aria-hidden />
        <h1 className="text-xl font-semibold">Request received</h1>
        <p className="text-sm text-muted-foreground">
          If an active account uses that email, a reset link has been issued. If nothing arrives, ask your
          programme or facility administrator to issue a reset link for you from the Users page.
        </p>
        <Link href="/login" className="text-sm font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the email address of your CARETRAIL account.</p>
      </div>
      {submitError && (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="username" autoFocus {...fieldAria('email', errors.email?.message)} {...form.register('email')} />
      </FormField>
      <Button type="submit" size="lg" className="h-10 w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
        Request reset link
      </Button>
      <Link href="/login" className="text-center text-sm font-medium text-brand-700 hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
