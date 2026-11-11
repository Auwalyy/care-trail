import type { CarePathway, ConsentMethod, ConsentPurpose, Language, PatientStatus } from './enums.js';

export const SEXES = ['female', 'male'] as const;
export type Sex = (typeof SEXES)[number];

export const PHONE_OWNERS = ['self', 'household', 'none'] as const;
export type PhoneOwner = (typeof PHONE_OWNERS)[number];

/** How the patient prefers to receive reminders (only used where consent allows). */
export const CONTACT_CHANNELS = ['sms', 'voice', 'none'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CARE_PATHWAY_LABELS: Record<CarePathway, string> = {
  antenatal: 'Pregnant (antenatal)',
  postnatal: 'New mother (postnatal)',
  newborn: 'Newborn',
  caregiver: 'Caregiver',
};

export const PATIENT_STATUS_LABELS: Record<PatientStatus, string> = {
  active: 'Active',
  transferred: 'Transferred',
  completed: 'Completed pathway',
  inactive: 'Inactive',
  deceased: 'Deceased',
};

export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  care_coordination: 'Care coordination (required)',
  sms: 'SMS reminders',
  voice: 'Voice-call reminders',
  facility_sharing: 'Share details with referral facilities',
};

export const CONSENT_METHOD_LABELS: Record<ConsentMethod, string> = {
  verbal: 'Verbal',
  thumbprint: 'Thumbprint',
  signature: 'Signature',
};

/** Coordination dates only — never clinical findings. */
export interface PathwayDetails {
  expectedDeliveryDate: string | null; // YYYY-MM-DD (antenatal)
  deliveryDate: string | null; // YYYY-MM-DD (postnatal)
  motherPatientId: string | null; // newborn → mother's record
}

export type ConsentSummary = Record<ConsentPurpose, { granted: boolean; recordedAt: string } | null>;

export interface PatientDto {
  id: string;
  patientCode: string;
  organisationId: string;
  communityId: string;
  householdId: string | null;
  assignedChw: { id: string; name: string | null };
  fullName: string;
  sex: Sex;
  /** Exactly one of dateOfBirth / estimatedBirthYear is set. */
  dateOfBirth: string | null;
  estimatedBirthYear: number | null;
  phone: string | null;
  alternatePhone: string | null;
  phoneOwner: PhoneOwner;
  carePathway: CarePathway;
  pathwayDetails: PathwayDetails;
  status: PatientStatus;
  statusReason: string | null;
  preferredLanguage: Language;
  preferredChannel: ContactChannel;
  consent: ConsentSummary;
  /** Registered despite a possible-duplicate warning — for administrator review. */
  possibleDuplicateOf: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface HouseholdDto {
  id: string;
  householdCode: string;
  organisationId: string;
  communityId: string;
  headName: string | null;
  landmark: string | null;
  phone: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdWithMembers extends HouseholdDto {
  /** Members visible to the caller (scope applies). */
  members: { id: string; patientCode: string; fullName: string; carePathway: CarePathway; status: PatientStatus }[];
}

export interface ConsentRecordDto {
  id: string;
  patientId: string;
  purposes: Record<ConsentPurpose, boolean>;
  method: ConsentMethod;
  consentTextVersion: string;
  language: Language;
  witnessName: string | null;
  recordedBy: { id: string; name: string | null };
  recordedAt: string;
}

/** Minimal information about a likely duplicate — enough to recognise, nothing more. */
export interface DuplicateCandidate {
  id: string;
  patientCode: string;
  fullName: string;
  birthYear: number;
  communityId: string;
  assignedChwName: string | null;
  status: PatientStatus;
}

export interface PatientTimelineEntry {
  at: string;
  kind: 'registered' | 'updated' | 'status' | 'reassigned' | 'consent' | 'viewed';
  summary: string;
  actor: { id: string; name: string | null } | null;
}

/**
 * Name key for duplicate detection: case-, accent-, punctuation- and word-order-insensitive
 * ("Aisha  Musa", "musa aisha", "Musa, Aïsha" → "aisha musa"). Shared so the mobile app can run
 * the same check offline.
 */
export function nameKey(fullName: string): string {
  return fullName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Birth year from a YYYY-MM-DD date or an estimated year. */
export function birthYearOf(p: { dateOfBirth: string | null; estimatedBirthYear: number | null }): number | null {
  if (p.dateOfBirth) return Number(p.dateOfBirth.slice(0, 4));
  return p.estimatedBirthYear;
}

/** Whole years between a birth date/year and `today` (YYYY-MM-DD). */
export function ageInYears(p: { dateOfBirth: string | null; estimatedBirthYear: number | null }, today: string): number | null {
  if (p.dateOfBirth) {
    let age = Number(today.slice(0, 4)) - Number(p.dateOfBirth.slice(0, 4));
    if (today.slice(5) < p.dateOfBirth.slice(5)) age--;
    return Math.max(0, age);
  }
  return p.estimatedBirthYear === null ? null : Math.max(0, Number(today.slice(0, 4)) - p.estimatedBirthYear);
}

export interface RegisterPatientResponse {
  patient: PatientDto;
  /** True when the same clientId was already registered (safe retry). */
  alreadyRegistered: boolean;
}
