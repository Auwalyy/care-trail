'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ScanLine, Search } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { isValidReferralCode, normaliseReferralCode } from '@caretrail/shared-types';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { RequirePermission } from '@/features/auth/require-session';
import { useSession } from '@/features/auth/session-store';
import { api } from '@/services/api';
import { ReferralActions } from './referral-actions';
import { ReferralFlags, ReferralStatusBadge } from './referral-labels';
import { ReferralSummary } from './referral-summary';

function VerifyContent() {
  const role = useSession((s) => s.user!.role);
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const result = useQuery({ queryKey: ['referral', 'code', submitted], queryFn: () => api.referrals.byCode(submitted!), enabled: Boolean(submitted), retry: false });

  const lookUp = (e: FormEvent) => {
    e.preventDefault();
    // The check symbol catches most typing mistakes before anything is sent.
    if (!isValidReferralCode(input)) {
      setLocalError('This code is not valid. Check each character on the receipt — the last character is a check symbol.');
      setSubmitted(null);
      return;
    }
    setLocalError(null);
    setSubmitted(normaliseReferralCode(input));
  };

  return (
    <>
      <PageHeader title="Verify a referral" description="Enter the code from the patient's referral receipt. Letters O and I are read as 0 and 1." />
      <Card className="mb-6 max-w-xl">
        <CardContent>
          <form onSubmit={lookUp} className="grid gap-3" noValidate>
            <Label htmlFor="code">Referral code</Label>
            <div className="flex gap-2">
              <Input id="code" value={input} onChange={(e) => setInput(e.target.value)} placeholder="CT-XXXX-XXXX" autoFocus autoComplete="off" className="h-11 font-mono text-lg uppercase tracking-wider" aria-invalid={localError ? true : undefined} aria-describedby={localError ? 'code-error' : undefined} />
              <Button type="submit" className="h-11"><Search aria-hidden /> Look up</Button>
            </div>
            {localError && <p id="code-error" role="alert" className="text-sm text-danger-700">{localError}</p>}
          </form>
        </CardContent>
      </Card>

      {submitted && result.isPending && <Skeleton className="h-64 w-full" />}
      {submitted && result.isError && <ErrorState error={result.error} />}
      {result.data && (
        <div className="grid gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-semibold">{result.data.referralCode}</span>
              <ReferralStatusBadge status={result.data.status} />
              <ReferralFlags r={result.data} />
            </div>
            <Button asChild variant="ghost"><Link href={`/referrals/${result.data.id}`}>Open referral <ExternalLink aria-hidden /></Link></Button>
          </div>
          <ReferralActions referral={result.data} role={role} />
          <ReferralSummary r={result.data} />
        </div>
      )}
      {!submitted && !localError && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><ScanLine className="size-4" aria-hidden /> Codes look like CT-7K3M-9QXA.</p>
      )}
    </>
  );
}

export function VerifyReferralPage() {
  return (
    <RequirePermission permission="referral:verify">
      <VerifyContent />
    </RequirePermission>
  );
}
