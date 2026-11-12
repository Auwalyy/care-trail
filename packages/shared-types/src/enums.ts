export const LANGUAGES = ['en', 'ha'] as const;
export type Language = (typeof LANGUAGES)[number];

export const USER_STATUSES = ['active', 'inactive', 'pending_activation'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const CARE_PATHWAYS = ['antenatal', 'postnatal', 'newborn', 'caregiver'] as const;
export type CarePathway = (typeof CARE_PATHWAYS)[number];

export const PATIENT_STATUSES = [
  'active',
  'transferred',
  'completed',
  'inactive',
  'deceased',
] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

export const CONSENT_PURPOSES = ['care_coordination', 'sms', 'voice', 'facility_sharing'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_METHODS = ['verbal', 'thumbprint', 'signature'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const VISIT_OUTCOMES = ['met', 'not_home', 'refused', 'moved', 'other'] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];

export const APPOINTMENT_CATEGORIES = [
  'antenatal',
  'postnatal',
  'immunisation',
  'preventive',
  'other',
] as const;
export type AppointmentCategory = (typeof APPOINTMENT_CATEGORIES)[number];

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'attended',
  'missed',
  'rescheduled',
  'cancelled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const REFERRAL_PRIORITIES = ['routine', 'urgent'] as const;
export type ReferralPriority = (typeof REFERRAL_PRIORITIES)[number];

export const FOLLOW_UP_REASONS = [
  'missed_appointment',
  'referral_not_arrived',
  'referral_incomplete',
  'overdue_follow_up',
  'manual',
] as const;
export type FollowUpReason = (typeof FOLLOW_UP_REASONS)[number];

export const CONTACT_METHODS = ['call', 'sms', 'visit'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const EDUCATION_CATEGORIES = [
  'antenatal_care',
  'postnatal_care',
  'newborn_care',
  'maternal_health_awareness',
  'immunisation',
  'preventive_healthcare',
  'when_to_seek_care',
] as const;
export type EducationCategory = (typeof EDUCATION_CATEGORIES)[number];

export const EDUCATION_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'published',
  'archived',
] as const;
export type EducationStatus = (typeof EDUCATION_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['sms', 'voice', 'push', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  'queued',
  'sending',
  'sent',
  'delivered',
  'failed',
  'not_sent_no_provider',
  'blocked_no_consent',
  'cancelled',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Status of a local mobile outbox operation. */
export const SYNC_STATUSES = ['pending', 'syncing', 'synced', 'failed', 'conflict'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** Server result for a pushed sync operation. */
export const SYNC_RESULT_STATUSES = ['applied', 'rejected', 'conflict'] as const;
export type SyncResultStatus = (typeof SYNC_RESULT_STATUSES)[number];
