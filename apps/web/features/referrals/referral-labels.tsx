import { AlertTriangle, Flag } from 'lucide-react';
import { REFERRAL_STATUS_LABELS, type ReferralDto, type ReferralStatus } from '@caretrail/shared-types';
import { Badge } from '@/components/ui/badge';

const STYLE: Record<ReferralStatus, string> = {
  issued: 'border-brand-600/20 bg-brand-50 text-brand-700',
  patient_arrived: 'border-teal-600/30 bg-teal-50 text-teal-700',
  service_recorded: 'border-teal-600/30 bg-teal-50 text-teal-700',
  follow_up_required: 'border-warning-700/20 bg-warning-50 text-warning-700',
  completed: 'border-success-700/20 bg-success-50 text-success-700',
  cancelled: 'bg-muted text-ink-muted',
  expired: 'border-danger-700/20 bg-danger-50 text-danger-700',
};

export function ReferralStatusBadge({ status }: { status: ReferralStatus }) {
  return <Badge variant="outline" className={STYLE[status]}>{REFERRAL_STATUS_LABELS[status]}</Badge>;
}

export function ReferralFlags({ r }: { r: Pick<ReferralDto, 'overdue' | 'priority'> }) {
  return (
    <>
      {r.priority === 'urgent' && (
        <Badge variant="outline" className="border-danger-700/20 bg-danger-50 text-danger-700"><Flag aria-hidden /> Urgent</Badge>
      )}
      {r.overdue && (
        <Badge variant="outline" className="border-warning-700/20 bg-warning-50 text-warning-700"><AlertTriangle aria-hidden /> Not yet arrived</Badge>
      )}
    </>
  );
}
