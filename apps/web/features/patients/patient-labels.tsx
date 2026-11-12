import { MessageSquare, Phone } from 'lucide-react';
import {
  CARE_PATHWAY_LABELS,
  PATIENT_STATUS_LABELS,
  ageInYears,
  type CarePathway,
  type PatientDto,
  type PatientStatus,
} from '@caretrail/shared-types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const PATHWAY_STYLE: Record<CarePathway, string> = {
  antenatal: 'border-brand-600/20 bg-brand-50 text-brand-700',
  postnatal: 'border-teal-600/30 bg-teal-50 text-teal-700',
  newborn: 'border-warning-700/20 bg-warning-50 text-warning-700',
  caregiver: 'bg-muted text-ink-muted',
};

export function PathwayBadge({ pathway }: { pathway: CarePathway }) {
  return <Badge variant="outline" className={PATHWAY_STYLE[pathway]}>{CARE_PATHWAY_LABELS[pathway]}</Badge>;
}

const STATUS_STYLE: Record<PatientStatus, string> = {
  active: 'border-success-700/20 bg-success-50 text-success-700',
  transferred: 'bg-muted text-ink-muted',
  completed: 'border-brand-600/20 bg-brand-50 text-brand-700',
  inactive: 'bg-muted text-ink-muted',
  deceased: 'bg-muted text-ink-muted',
};

export function PatientStatusBadge({ status }: { status: PatientStatus }) {
  return <Badge variant="outline" className={STATUS_STYLE[status]}>{PATIENT_STATUS_LABELS[status]}</Badge>;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

/** "24 yrs (estimated)" / "3 Jan 2001 · 25 yrs" */
export function describeAge(p: Pick<PatientDto, 'dateOfBirth' | 'estimatedBirthYear'>): string {
  const age = ageInYears(p, todayIso());
  if (age === null) return '—';
  if (p.dateOfBirth) return `${formatDate(p.dateOfBirth)} · ${age} yr${age === 1 ? '' : 's'}`;
  return `About ${age} yrs (estimated)`;
}

/** The single most useful pathway date for lists. */
export function keyPathwayDate(p: PatientDto): string | null {
  if (p.carePathway === 'antenatal' && p.pathwayDetails.expectedDeliveryDate) return `Due ${formatDate(p.pathwayDetails.expectedDeliveryDate)}`;
  if (p.carePathway === 'postnatal' && p.pathwayDetails.deliveryDate) return `Delivered ${formatDate(p.pathwayDetails.deliveryDate)}`;
  if (p.carePathway === 'newborn' && p.dateOfBirth) return `Born ${formatDate(p.dateOfBirth)}`;
  return null;
}

/** Icons for the reminder channels the patient has consented to. */
export function ReminderConsentIcons({ p, className }: { p: PatientDto; className?: string }) {
  const sms = p.consent.sms?.granted;
  const voice = p.consent.voice?.granted;
  if (!sms && !voice) return <span className={cn('text-muted-foreground', className)}>None</span>;
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {sms && <MessageSquare className="size-4 text-teal-700" aria-label="SMS reminders consented" />}
      {voice && <Phone className="size-4 text-teal-700" aria-label="Voice reminders consented" />}
    </span>
  );
}
