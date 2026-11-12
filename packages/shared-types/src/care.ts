import type { AppointmentCategory, AppointmentStatus, ContactMethod, FollowUpReason } from './enums.js';
import type { FollowUpStatus } from './follow-up.js';
import type { ActorRef, ReferralPatientSummary } from './referrals.js';

/** Minimal patient facts shared with facility staff (referrals and appointments). */
export type PatientSummary = ReferralPatientSummary;

export const APPOINTMENT_CATEGORY_LABELS: Record<AppointmentCategory, string> = {
  antenatal: 'Antenatal visit',
  postnatal: 'Postnatal visit',
  immunisation: 'Immunisation',
  preventive: 'Preventive care',
  other: 'Other',
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  attended: 'Attended',
  missed: 'Missed',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
};

export interface AppointmentDto {
  id: string;
  organisationId: string;
  patient: PatientSummary;
  facilityId: string;
  category: AppointmentCategory;
  /** YYYY-MM-DD */
  scheduledFor: string;
  status: AppointmentStatus;
  attendance: { at: string; by: ActorRef } | null;
  cancellation: { at: string; by: ActorRef; reason: string } | null;
  reschedules: { from: string; to: string; at: string; by: ActorRef }[];
  missedDetectedAt: string | null;
  createdBy: ActorRef;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const FOLLOW_UP_REASON_LABELS: Record<FollowUpReason, string> = {
  missed_appointment: 'Missed appointment',
  referral_not_arrived: 'Referral: patient not yet arrived',
  referral_incomplete: 'Referral needs further follow-up',
  overdue_follow_up: 'Overdue follow-up',
  manual: 'Follow-up requested',
};

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  in_progress: 'In progress',
  contacted: 'Contacted',
  resolved: 'Resolved',
  escalated: 'Escalated',
};

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = { call: 'Phone call', sms: 'SMS', visit: 'Home visit' };

export interface ContactAttemptDto {
  at: string;
  by: ActorRef;
  method: ContactMethod;
  reached: boolean;
  response: string | null;
}

export interface FollowUpTaskDto {
  id: string;
  organisationId: string;
  patient: PatientSummary;
  assignedChw: ActorRef;
  source: { type: 'appointment' | 'referral' | 'manual'; id: string | null; label: string | null };
  reason: FollowUpReason;
  status: FollowUpStatus;
  /** YYYY-MM-DD */
  dueOn: string;
  overdue: boolean;
  note: string | null;
  attempts: ContactAttemptDto[];
  outcome: string | null;
  nextAction: string | null;
  escalation: { at: string; by: ActorRef; to: ActorRef[]; notes: string } | null;
  createdBy: ActorRef | null; // null = created by the missed-care check
  resolvedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MissedCareRunResult {
  ranAt: string;
  appointmentsMarkedMissed: number;
  referralsExpired: number;
  tasksCreated: number;
}
