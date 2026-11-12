import { APPOINTMENT_STATUS_LABELS, FOLLOW_UP_STATUS_LABELS, type AppointmentStatus, type FollowUpStatus } from '@caretrail/shared-types';
import { Badge } from '@/components/ui/badge';

const APPT: Record<AppointmentStatus, string> = {
  scheduled: 'border-brand-600/20 bg-brand-50 text-brand-700',
  attended: 'border-success-700/20 bg-success-50 text-success-700',
  missed: 'border-danger-700/20 bg-danger-50 text-danger-700',
  rescheduled: 'bg-muted text-ink-muted',
  cancelled: 'bg-muted text-ink-muted',
};

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return <Badge variant="outline" className={APPT[status]}>{APPOINTMENT_STATUS_LABELS[status]}</Badge>;
}

const TASK: Record<FollowUpStatus, string> = {
  pending: 'border-warning-700/20 bg-warning-50 text-warning-700',
  assigned: 'border-brand-600/20 bg-brand-50 text-brand-700',
  in_progress: 'border-brand-600/20 bg-brand-50 text-brand-700',
  contacted: 'border-teal-600/30 bg-teal-50 text-teal-700',
  resolved: 'border-success-700/20 bg-success-50 text-success-700',
  escalated: 'border-danger-700/20 bg-danger-50 text-danger-700',
};

export function TaskStatusBadge({ status }: { status: FollowUpStatus }) {
  return <Badge variant="outline" className={TASK[status]}>{FOLLOW_UP_STATUS_LABELS[status]}</Badge>;
}

export const plusDaysIso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
