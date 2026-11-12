import type { CarePathway, ReferralPriority } from './enums.js';
import type { Sex } from './patients.js';
import type { ReferralStatus } from './referral.js';

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  issued: 'Issued',
  patient_arrived: 'Patient arrived',
  service_recorded: 'Service recorded',
  follow_up_required: 'Further follow-up required',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** Statuses where the referral loop is still open. */
export const OPEN_REFERRAL_STATUSES: readonly ReferralStatus[] = [
  'issued',
  'patient_arrived',
  'service_recorded',
  'follow_up_required',
  'expired',
];

/**
 * The minimum facility staff need to receive a referred patient (decision A29): no phone numbers,
 * household details or consent history.
 */
export interface ReferralPatientSummary {
  id: string;
  patientCode: string;
  fullName: string;
  sex: Sex;
  dateOfBirth: string | null;
  estimatedBirthYear: number | null;
  carePathway: CarePathway;
  expectedDeliveryDate: string | null;
  deliveryDate: string | null;
}

/** Approved instruction text as it was when the referral was issued (immutable snapshot). */
export interface ReferralInstruction {
  templateId: string;
  title: string;
  body: string;
  bodyHa: string | null;
  templateVersion: number;
}

export interface ActorRef {
  id: string;
  name: string | null;
}

export interface ReferralDto {
  id: string;
  referralCode: string;
  organisationId: string;
  patient: ReferralPatientSummary;
  origin: { type: 'community' | 'facility'; communityId: string | null; facilityId: string | null };
  toFacilityId: string;
  issuedBy: ActorRef & { role: string };
  issuedAt: string;
  /** YYYY-MM-DD */
  expectedArrivalBy: string;
  /** True while awaiting arrival after the expected date. */
  overdue: boolean;
  reason: string;
  instructions: ReferralInstruction[];
  priority: ReferralPriority | null;
  status: ReferralStatus;
  arrival: { at: string; by: ActorRef } | null;
  service: { at: string; by: ActorRef; summary: string } | null;
  completion: { at: string; by: ActorRef } | null;
  followUpNote: string | null;
  cancellation: { at: string; by: ActorRef; reason: string } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReferralEventDto {
  id: string;
  kind: 'status' | 'priority';
  fromStatus: ReferralStatus | null;
  toStatus: ReferralStatus | null;
  priority: ReferralPriority | null;
  actor: ActorRef & { role: string | null };
  facilityId: string | null;
  at: string;
  note: string | null;
  source: 'web' | 'mobile' | 'system';
}

export const TEMPLATE_STATUSES = ['draft', 'approved', 'retired'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/**
 * Programme-authored referral instruction text. Only `approved` templates (with a recorded
 * clinical reviewer) can be attached to referrals; editing an approved template's text returns it
 * to draft.
 */
export interface InstructionTemplateDto {
  id: string;
  organisationId: string;
  title: string;
  body: string;
  bodyHa: string | null;
  status: TemplateStatus;
  approval: { reviewerName: string; reviewerCredentials: string; approvedOn: string; recordedBy: ActorRef } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedReferralResponse {
  referral: ReferralDto;
  /** True when the same clientId was already submitted (safe retry). */
  alreadyIssued: boolean;
}
