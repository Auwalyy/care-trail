import type { AppointmentDto, FollowUpTaskDto } from './care.js';
import type { CommunityDto, FacilityDto } from './directory.js';
import type { VisitOutcome } from './enums.js';
import type { HouseholdDto, PatientDto } from './patients.js';
import type { EducationContentDto, InboxItemDto } from './engagement.js';
import type { InstructionTemplateDto, ReferralDto } from './referrals.js';

export const VISIT_OUTCOME_LABELS: Record<VisitOutcome, string> = {
  met: 'Met the patient',
  not_home: 'Not at home',
  refused: 'Declined the visit',
  moved: 'Has moved away',
  other: 'Other',
};

export interface VisitDto {
  id: string;
  organisationId: string;
  patientId: string;
  chw: { id: string; name: string | null };
  visitDate: string; // YYYY-MM-DD
  outcome: VisitOutcome;
  followUpRequired: boolean;
  nextActivityDate: string | null;
  /** Operational notes only — no clinical findings. */
  notes: string | null;
  createdAt: string;
  version: number;
}

/** Operations a device may queue while offline. */
export const SYNC_OP_TYPES = [
  'patient.register',
  'patient.update',
  'consent.record',
  'visit.create',
  'referral.create',
  'appointment.create',
  'followup.create',
  'followup.attempt',
  'followup.resolve',
] as const;
export type SyncOpType = (typeof SYNC_OP_TYPES)[number];

/** A reference to a patient created on the device that may not have a server id yet. */
export const LOCAL_REF_PREFIX = 'local:';

export interface SyncOperation {
  /** UUID v4/v7 generated on the device — also the idempotency key. */
  opId: string;
  opType: SyncOpType;
  /** For updates: the server id of the target. */
  targetId?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type SyncOpResult =
  | { opId: string; status: 'applied'; serverId: string; entity: unknown; replayed: boolean }
  | { opId: string; status: 'rejected'; error: { code: string; message: string; details?: unknown } }
  | { opId: string; status: 'conflict'; error: { code: string; message: string }; current: unknown }
  /** Temporary problem (e.g. a referenced record not synced yet): retry later. */
  | { opId: string; status: 'retry'; error: { code: string; message: string } };

export interface SyncPushRequest {
  deviceId: string;
  appVersion: string;
  /** Operations still queued on the device after this batch (for supervisors' sync monitoring). */
  pendingOperations: number;
  operations: SyncOperation[];
}

export interface SyncPushResponse {
  results: SyncOpResult[];
  serverTime: string;
}

export interface SyncSettings {
  offlineSessionGraceDays: number;
  consentTextVersion: string | null;
  referralExpectedArrivalDays: number;
}

/** Changes for the CHW's working set since `since` (or everything on first sync). */
export interface SyncPullResponse {
  /** Education items changed since the cursor (any status; the phone keeps only published ones). */
  education: EducationContentDto[];
  /** The CHW's in-app messages from the last 30 days changed since the cursor. */
  messages: InboxItemDto[];
  /** Pass back as `since` on the next pull. */
  cursor: string;
  serverTime: string;
  patients: PatientDto[];
  /** Every patient currently assigned to the CHW — anything else on the device must be purged. */
  assignedPatientIds: string[];
  households: HouseholdDto[];
  referrals: ReferralDto[];
  appointments: AppointmentDto[];
  followUps: FollowUpTaskDto[];
  visits: VisitDto[];
  facilities: FacilityDto[];
  communities: CommunityDto[];
  templates: InstructionTemplateDto[];
  settings: SyncSettings;
  canIssueReferrals: boolean;
}
