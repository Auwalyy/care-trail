'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@caretrail/api-client';
import { REFERRAL_STATUS_LABELS, availableReferralTransitions, type ReferralDto, type ReferralStatus, type Role } from '@caretrail/shared-types';
import { errorMessage } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/features/auth/session-store';
import { api } from '@/services/api';

const ACTION_LABELS: Partial<Record<ReferralStatus, string>> = {
  patient_arrived: 'Confirm arrival',
  service_recorded: 'Record service provided',
  completed: 'Complete referral',
  follow_up_required: 'Needs further follow-up',
  cancelled: 'Cancel referral',
};

const PROMPTS: Partial<Record<ReferralStatus, { label: string; field: 'note' | 'serviceSummary'; help: string }>> = {
  service_recorded: { label: 'Services provided', field: 'serviceSummary', help: 'Briefly describe what was done. Shared with the referring health worker.' },
  follow_up_required: { label: 'Follow-up needed', field: 'note', help: 'What should happen next? The community health worker will see this.' },
  cancelled: { label: 'Reason for cancelling', field: 'note', help: 'Required.' },
};

/** Buttons for the transitions the shared state machine allows this role. The API re-checks everything. */
export function ReferralActions({ referral, role }: { referral: ReferralDto; role: Role }) {
  const qc = useQueryClient();
  const canPrioritise = useCan('referral:set-priority');
  const actions = availableReferralTransitions(referral.status, role);
  const [target, setTarget] = useState<ReferralStatus | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = referral.status === 'completed' || referral.status === 'cancelled';

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['referrals'] });
    await qc.invalidateQueries({ queryKey: ['referral'] });
    await qc.invalidateQueries({ queryKey: ['overview'] });
  };

  const run = async (to: ReferralStatus) => {
    const prompt = PROMPTS[to];
    setBusy(true);
    setError(null);
    try {
      await api.referrals.transition(referral.id, {
        toStatus: to,
        version: referral.version,
        ...(prompt?.field === 'note' ? { note: text } : {}),
        ...(prompt?.field === 'serviceSummary' ? { serviceSummary: text } : {}),
      });
      toast.success(`Referral: ${REFERRAL_STATUS_LABELS[to]}`);
      setTarget(null);
      setText('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        toast.error('This referral was updated by someone else. It has been reloaded.');
        setTarget(null);
        await refresh();
      } else {
        setError(err instanceof ApiError && err.fieldErrors[0] ? err.fieldErrors[0].message : errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const prompt = target ? PROMPTS[target] : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((to) => (
        <Button key={to} variant={to === 'cancelled' ? 'outline' : to === 'follow_up_required' ? 'secondary' : 'default'} className="h-9" onClick={() => { setTarget(to); setText(''); setError(null); }}>
          {ACTION_LABELS[to] ?? REFERRAL_STATUS_LABELS[to]}
        </Button>
      ))}
      {canPrioritise && !closed && (
        <Select
          value={referral.priority ?? ''}
          onValueChange={async (p) => {
            try {
              await api.referrals.setPriority(referral.id, p as 'routine' | 'urgent', referral.version);
              toast.success(`Priority set to ${p}`);
              await refresh();
            } catch (err) {
              toast.error(errorMessage(err));
              await refresh();
            }
          }}
        >
          <SelectTrigger className="h-9 w-40" aria-label="Priority"><SelectValue placeholder="Set priority" /></SelectTrigger>
          <SelectContent><SelectItem value="routine">Routine</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent>
        </Select>
      )}

      <Dialog open={target !== null} onOpenChange={(o) => !o && !busy && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target ? (ACTION_LABELS[target] ?? REFERRAL_STATUS_LABELS[target]) : ''}</DialogTitle>
            <DialogDescription>
              {referral.patient.fullName} · <span className="font-mono">{referral.referralCode}</span>
            </DialogDescription>
          </DialogHeader>
          {prompt && (
            <div className="grid gap-1.5">
              <Label htmlFor="transition-text">{prompt.label}</Label>
              <Textarea id="transition-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
              <p className="text-sm text-muted-foreground">{prompt.help}</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>Back</Button>
            <Button onClick={() => target && run(target)} disabled={busy || (Boolean(prompt) && !text.trim())}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
