import type { EducationCategory, EducationStatus, Language, NotificationChannel, NotificationStatus } from './enums.js';
import type { ActorRef } from './referrals.js';

// ── Education content ───────────────────────────────────────────────────────────

export const EDUCATION_CATEGORY_LABELS: Record<EducationCategory, string> = {
  antenatal_care: 'Antenatal care',
  postnatal_care: 'Postnatal care',
  newborn_care: 'Newborn care',
  maternal_health_awareness: 'Maternal health awareness',
  immunisation: 'Immunisation',
  preventive_healthcare: 'Preventive healthcare',
  when_to_seek_care: 'When to seek care',
};

/**
 * draft → in_review → approved → published → archived.
 * A reviewer can return in_review content to draft. Changing the text or audio of approved or
 * published content sends it back to draft (it is no longer what was reviewed).
 */
export const EDUCATION_STATUS_LABELS: Record<EducationStatus, string> = {
  draft: 'Draft',
  in_review: 'Awaiting clinical review',
  approved: 'Approved',
  published: 'Published',
  archived: 'Archived',
};

export const EDUCATION_ACTIONS = ['submit', 'return', 'approve', 'publish', 'unpublish', 'archive'] as const;
export type EducationAction = (typeof EDUCATION_ACTIONS)[number];

/** Allowed workflow steps: action → [from statuses, to status]. */
export const EDUCATION_TRANSITIONS: Record<EducationAction, { from: readonly EducationStatus[]; to: EducationStatus }> = {
  submit: { from: ['draft'], to: 'in_review' },
  return: { from: ['in_review'], to: 'draft' },
  approve: { from: ['in_review'], to: 'approved' },
  publish: { from: ['approved'], to: 'published' },
  unpublish: { from: ['published'], to: 'approved' },
  archive: { from: ['draft', 'in_review', 'approved', 'published'], to: 'archived' },
};

export const AUDIO_CONTENT_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm'] as const;
export type AudioContentType = (typeof AUDIO_CONTENT_TYPES)[number];
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export interface EducationAudioDto {
  contentType: AudioContentType;
  size: number;
  uploadedAt: string;
}

export interface EducationContentDto {
  id: string;
  organisationId: string;
  category: EducationCategory;
  title: string;
  body: string;
  /** Hausa version; distributed only when present at the time of approval. */
  titleHa: string | null;
  bodyHa: string | null;
  audio: Record<Language, EducationAudioDto | null>;
  status: EducationStatus;
  approval: { reviewerName: string; reviewerCredentials: string; approvedOn: string; recordedBy: ActorRef } | null;
  /** Why a reviewer returned it to draft (shown to the author). */
  reviewNote: string | null;
  publishedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Notifications ───────────────────────────────────────────────────────────────

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = { sms: 'SMS', voice: 'Voice call', push: 'Push', in_app: 'In-app' };

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  not_sent_no_provider: 'Not sent: no provider configured',
  blocked_no_consent: 'Not sent: no consent',
  cancelled: 'Cancelled',
};

/**
 * Message templates. They carry **no medical details**: no reasons, diagnoses or care pathway,
 * and no patient name in messages to patients (phones are often shared). The Hausa wording is a
 * draft that must be reviewed before reminders are switched on (decision A41).
 */
export const NOTIFICATION_TEMPLATES = {
  appointment_reminder: {
    label: 'Appointment reminder',
    audience: 'patient',
    params: ['facility', 'date'],
    en: 'CARETRAIL: Reminder of your appointment at {facility} on {date}.',
    ha: 'CARETRAIL: Tunatarwa game da ganawarki a {facility} ranar {date}.',
  },
  referral_reminder: {
    label: 'Referral reminder',
    audience: 'patient',
    params: ['facility', 'date', 'code'],
    en: 'CARETRAIL: Please visit {facility} by {date}. Show code {code}.',
    ha: 'CARETRAIL: Don Allah ki je {facility} kafin {date}. Nuna lamba {code}.',
  },
  followup_assigned: {
    label: 'New follow-up task',
    audience: 'user',
    params: ['patientCode', 'date'],
    en: 'New follow-up task for patient {patientCode}, due {date}.',
    ha: 'Sabon aikin bibiya ga majiyyaci {patientCode}, kafin {date}.',
  },
  followup_escalated: {
    label: 'Follow-up escalated to you',
    audience: 'user',
    params: ['patientCode'],
    en: 'A follow-up for patient {patientCode} was escalated to you.',
    ha: 'An tura miki/maka bibiyar majiyyaci {patientCode}.',
  },
} as const satisfies Record<string, { label: string; audience: 'patient' | 'user'; params: readonly string[]; en: string; ha: string }>;
export type NotificationTemplateKey = keyof typeof NOTIFICATION_TEMPLATES;
export const NOTIFICATION_TEMPLATE_KEYS = Object.keys(NOTIFICATION_TEMPLATES) as NotificationTemplateKey[];

/** Fills `{param}` placeholders. Unknown placeholders are left as-is so a gap is visible. */
export function renderNotification(key: NotificationTemplateKey, language: Language, params: Record<string, string>): string {
  return NOTIFICATION_TEMPLATES[key][language].replace(/\{(\w+)\}/g, (m, p: string) => params[p] ?? m);
}

export interface NotificationLink {
  type: 'follow_up' | 'appointment' | 'referral';
  id: string;
}

/** A message in the signed-in user's in-app inbox. */
export interface InboxItemDto {
  id: string;
  templateKey: NotificationTemplateKey;
  /** Rendered in the requested language. */
  text: string;
  /** Lets the mobile app render the text in the CHW's language offline. */
  params: Record<string, string>;
  link: NotificationLink | null;
  createdAt: string;
  readAt: string | null;
}

/** Delivery history row (programme staff). Never includes the phone number. */
export interface NotificationDto {
  id: string;
  organisationId: string;
  channel: NotificationChannel;
  templateKey: NotificationTemplateKey;
  language: Language;
  recipient: { type: 'patient' | 'user'; id: string; label: string | null };
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  scheduledFor: string;
  sentAt: string | null;
  createdBy: ActorRef | null;
  createdAt: string;
}

export interface DispatchRunResult {
  remindersPlanned: number;
  processed: number;
  sent: number;
  failed: number;
  notSent: number;
  blocked: number;
}
