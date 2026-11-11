'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { webLandingPath } from '@caretrail/shared-types';
import { loginSchema } from '@caretrail/validation';
import { FormField, fieldAria } from '@/components/form/form-field';
import { errorMessage } from '@/components/states/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';
import { safeNextPath } from './safe-next';
import { useSession } from './session-store';

const schema = loginSchema.pick({ email: true, password: true });
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  // Already signed in (session restored from cookie) → go straight in.
  useEffect(() => {
    if (session.status === 'authenticated' && session.user) {
      router.replace(safeNextPath(params.get('next')) ?? webLandingPath(session.user.role));
    }
  }, [session.status, session.user, params, router]);

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setSubmitError(null);
    try {
      const result = await api.auth.login(email, password, 'web');
      useSession.getState().setSession(result);
      router.replace(safeNextPath(params.get('next')) ?? webLandingPath(result.user.role));
    } catch (err) {
      setSubmitError(errorMessage(err));
      form.resetField('password');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use the account your programme administrator created for you.</p>
      </div>

      {(submitError ?? session.restoreError) && (
        <Alert variant="destructive">
          <AlertDescription>{submitError ?? session.restoreError}</AlertDescription>
        </Alert>
      )}

      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="username" inputMode="email" autoFocus {...fieldAria('email', errors.email?.message)} {...form.register('email')} />
      </FormField>

      <FormField id="password" label="Password" error={errors.password?.message}>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className="pe-10"
            {...fieldAria('password', errors.password?.message)}
            {...form.register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </FormField>

      <Button type="submit" size="lg" className="h-10 w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
        Sign in
      </Button>

      <Link href="/forgot-password" className="text-center text-sm font-medium text-brand-700 hover:underline">
        Forgot your password?
      </Link>
    </form>
  );
}
