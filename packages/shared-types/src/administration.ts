import type { IssuedLink, UserDto } from './auth.js';

/** A community health worker: a user with role `chw` plus programme profile data. */
export interface ChwDto {
  /** The CHW's user id (one profile per user). */
  id: string;
  user: UserDto;
  programmeAreas: string[];
  canIssueReferrals: boolean;
  supervisorUserId: string | null;
  /** Active patients assigned to this CHW. */
  assignedPatients: number;
  /** Populated by the sync engine (Phase 8). Null until the CHW's device first syncs. */
  device: { lastSyncAt: string | null; appVersion: string | null; pendingOperations: number | null };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedChwResponse {
  chw: ChwDto;
  activation: IssuedLink;
}

/** Proposed pilot values from the programme design — NOT confirmed deployments. */
export const PROPOSED_PILOT_TARGETS = {
  communities: 2,
  facilities: 2,
  chws: 10,
  patients: 200,
  durationWeeks: 12,
} as const;

export interface PilotTargets {
  communities: number | null;
  facilities: number | null;
  chws: number | null;
  patients: number | null;
  durationWeeks: number | null;
  startDate: string | null; // YYYY-MM-DD
}

export interface ProgrammeSettingsDto {
  organisationId: string;
  pilot: PilotTargets;
  /** Days after issue by which a referred patient is expected at the facility. */
  referralExpectedArrivalDays: number;
  /** Days after the appointment date before it is treated as missed. */
  appointmentOverdueGraceDays: number;
  /** How long the mobile app may be unlocked offline before an online sign-in is required. */
  offlineSessionGraceDays: number;
  /**
   * Version reference of the programme-approved consent wording (EN/HA) that CHWs read out.
   * CARETRAIL records which version was used; the wording itself is owned by the programme.
   */
  consentTextVersion: string | null;
  /** False until an administrator saves settings for the first time (defaults shown). */
  configured: boolean;
  version: number;
  updatedAt: string | null;
}

export const DEFAULT_PROGRAMME_SETTINGS = {
  referralExpectedArrivalDays: 7,
  appointmentOverdueGraceDays: 1,
  offlineSessionGraceDays: 14,
  consentTextVersion: null,
} as const;

export interface AuditLogDto {
  id: string;
  at: string;
  action: string;
  outcome: 'success' | 'failure';
  actor: { id: string; name: string | null; role: string | null } | null;
  organisationId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
}

/** Aggregated counts only — no personal data. Extended with patients/referrals in later phases. */
export interface OverviewDto {
  organisationId: string | null;
  facilities: { active: number; total: number };
  communities: { active: number; total: number };
  chws: { active: number; pendingActivation: number; total: number };
  staff: { active: number; total: number };
  patients: { active: number; total: number };
  referrals: { open: number; completed: number; overdue: number; total: number };
  appointments: { upcoming7d: number; missed: number; attended: number; total: number };
  followUps: { open: number; overdue: number; escalated: number; resolved: number; reachedRate: number | null };
  pilot: PilotTargets | null;
  generatedAt: string;
}
