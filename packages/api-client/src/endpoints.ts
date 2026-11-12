import type { AppointmentCategory, AppointmentDto, ContactMethod, FollowUpReason, FollowUpTaskDto, MissedCareRunResult } from '@caretrail/shared-types';
import type {
  ApiList,
  ApiSuccess,
  AuditLogDto,
  AuthClient,
  AuthenticatedUser,
  CarePathway,
  ConsentMethod,
  ConsentPurpose,
  ConsentRecordDto,
  CreatedReferralResponse,
  InstructionTemplateDto,
  ReferralDto,
  ReferralEventDto,
  ReferralPriority,
  ReferralStatus,
  TemplateStatus,
  ContactChannel,
  HouseholdDto,
  HouseholdWithMembers,
  PatientDto,
  PatientStatus,
  PatientTimelineEntry,
  PhoneOwner,
  RegisterPatientResponse,
  Sex,
  ChwDto,
  CommunityDto,
  CreatedChwResponse,
  CreatedUserResponse,
  FacilityDto,
  FacilityType,
  IssuedLink,
  Language,
  LoginResponse,
  OrganisationDto,
  OverviewDto,
  PilotTargets,
  ProgrammeSettingsDto,
  RecordStatus,
  Role,
  UserDto,
  UserStatus,
} from '@caretrail/shared-types';

export interface ListReferralsParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  /** Comma-separated statuses. */
  status?: string;
  open?: 'true';
  overdue?: 'true';
  toFacilityId?: string;
  patientId?: string;
  q?: string;
  organisationId?: string;
}
export interface CreateReferralBody {
  clientId?: string;
  patientId: string;
  toFacilityId: string;
  reason: string;
  instructionTemplateIds?: string[];
}
export interface ReferralTransitionBody {
  toStatus: ReferralStatus;
  note?: string | null;
  serviceSummary?: string | null;
  version: number;
}

export interface ListPatientsParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  q?: string;
  communityId?: string;
  assignedChwId?: string;
  carePathway?: CarePathway;
  status?: PatientStatus;
  possibleDuplicate?: 'true';
  organisationId?: string;
}
export interface ConsentBody {
  purposes: Record<ConsentPurpose, boolean>;
  method: ConsentMethod;
  consentTextVersion: string;
  language: Language;
  witnessName?: string | null;
}
export interface RegisterPatientBody {
  clientId?: string;
  fullName: string;
  sex: Sex;
  dateOfBirth?: string | null;
  estimatedAge?: number | null;
  phone?: string | null;
  alternatePhone?: string | null;
  phoneOwner?: PhoneOwner;
  communityId: string;
  household?: { mode: 'none' } | { mode: 'existing'; householdId: string } | { mode: 'new'; headName?: string | null; landmark?: string | null; phone?: string | null };
  carePathway: CarePathway;
  pathwayDetails?: { expectedDeliveryDate?: string | null; deliveryDate?: string | null; motherPatientId?: string | null };
  preferredLanguage?: Language;
  preferredChannel?: ContactChannel;
  assignedChwId?: string | null;
  organisationId?: string | null;
  confirmNotDuplicate?: boolean;
  consent: ConsentBody;
}
export interface UpdatePatientBody {
  fullName?: string;
  sex?: Sex;
  dateOfBirth?: string | null;
  estimatedAge?: number | null;
  phone?: string | null;
  alternatePhone?: string | null;
  phoneOwner?: PhoneOwner;
  communityId?: string;
  householdId?: string | null;
  carePathway?: CarePathway;
  pathwayDetails?: { expectedDeliveryDate?: string | null; deliveryDate?: string | null; motherPatientId?: string | null };
  preferredLanguage?: Language;
  preferredChannel?: ContactChannel;
  version: number;
}

export interface OrganisationBody {
  name?: string;
  code?: string;
  state?: string;
  contactEmail?: string | null;
  status?: RecordStatus;
}
export interface FacilityBody {
  organisationId?: string | null;
  name?: string;
  code?: string;
  type?: FacilityType;
  lga?: string;
  ward?: string | null;
  address?: string | null;
  phone?: string | null;
  status?: RecordStatus;
}
export interface CommunityBody {
  organisationId?: string | null;
  name?: string;
  lga?: string;
  ward?: string | null;
  status?: RecordStatus;
}
export interface CreateChwBody {
  fullName: string;
  email: string;
  phone?: string | null;
  preferredLanguage?: Language;
  organisationId?: string | null;
  communityIds: string[];
  programmeAreas?: string[];
  canIssueReferrals?: boolean;
  supervisorUserId?: string | null;
}
export interface UpdateChwBody {
  communityIds?: string[];
  programmeAreas?: string[];
  canIssueReferrals?: boolean;
  supervisorUserId?: string | null;
  version: number;
}
export interface ListChwsParams {
  page?: number;
  pageSize?: number;
  q?: string;
  communityId?: string;
  status?: UserStatus;
  organisationId?: string;
}
export interface SettingsBody {
  pilot: PilotTargets;
  referralExpectedArrivalDays: number;
  appointmentOverdueGraceDays: number;
  offlineSessionGraceDays: number;
  /** Omit to keep the current value. */
  consentTextVersion?: string | null;
  version: number;
}
export interface ListAuditParams {
  page?: number;
  pageSize?: number;
  action?: string;
  outcome?: 'success' | 'failure';
  entityType?: string;
  entityId?: string;
  actorId?: string;
  organisationId?: string;
  from?: Date;
  to?: Date;
}
import type { ApiClient, QueryValue } from './client.js';

export interface ListUsersParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  q?: string;
  role?: Role;
  status?: UserStatus;
  organisationId?: string;
  facilityId?: string;
}

export interface CreateUserBody {
  email: string;
  fullName: string;
  role: Role;
  phone?: string | null;
  preferredLanguage?: Language;
  organisationId?: string | null;
  facilityId?: string | null;
  communityIds?: string[];
}

export interface UpdateUserBody {
  fullName?: string;
  phone?: string | null;
  preferredLanguage?: Language;
  facilityId?: string | null;
  communityIds?: string[];
  version: number;
}

export interface DirectoryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: 'active' | 'inactive';
  organisationId?: string;
}

const data = async <T>(p: Promise<ApiSuccess<T>>) => (await p).data;
const q = (params?: object) => params as Record<string, QueryValue> | undefined;

/** Standard list/get/create/update endpoints for organisation-scoped reference data. */
function crud<D, B>(client: ApiClient, base: string) {
  return {
    list: (params?: DirectoryParams) => client.get<ApiList<D>>(base, { query: q(params) }),
    get: (id: string) => client.getData<D>(`${base}/${id}`),
    create: (body: B) => data(client.post<ApiSuccess<D>>(base, body)),
    update: (id: string, body: B & { version: number }) => data(client.patch<ApiSuccess<D>>(`${base}/${id}`, body)),
  };
}

/** Typed endpoint functions shared by the web and mobile apps. */
export function createCaretrailApi(client: ApiClient) {
  return {
    auth: {
      login: (email: string, password: string, client_: AuthClient, deviceId?: string) =>
        data(client.post<ApiSuccess<LoginResponse>>('/auth/login', { email, password, client: client_, deviceId }, { anonymous: true })),
      /** Web: refresh token travels in the httpOnly cookie. Mobile: pass it explicitly. */
      refresh: (refreshToken?: string) =>
        data(client.post<ApiSuccess<LoginResponse>>('/auth/refresh', refreshToken ? { refreshToken } : {}, { anonymous: true })),
      logout: (opts: { refreshToken?: string; allDevices?: boolean } = {}) =>
        client.post<void>('/auth/logout', opts, { anonymous: true }),
      forgotPassword: (email: string) =>
        data(client.post<ApiSuccess<{ message: string }>>('/auth/forgot-password', { email }, { anonymous: true })),
      resetPassword: (token: string, password: string) =>
        data(client.post<ApiSuccess<{ activated: boolean }>>('/auth/reset-password', { token, password }, { anonymous: true })),
      me: () => client.getData<AuthenticatedUser>('/auth/me'),
      changePassword: (currentPassword: string, newPassword: string) =>
        data(client.post<ApiSuccess<LoginResponse>>('/auth/change-password', { currentPassword, newPassword })),
    },
    users: {
      list: (params?: ListUsersParams) => client.get<ApiList<UserDto>>('/users', { query: q(params) }),
      get: (id: string) => client.getData<UserDto>(`/users/${id}`),
      create: (body: CreateUserBody) => data(client.post<ApiSuccess<CreatedUserResponse>>('/users', body)),
      update: (id: string, body: UpdateUserBody) => data(client.patch<ApiSuccess<UserDto>>(`/users/${id}`, body)),
      setStatus: (id: string, status: 'active' | 'inactive', version: number) =>
        data(client.post<ApiSuccess<UserDto>>(`/users/${id}/status`, { status, version })),
      issuePasswordLink: (id: string) => data(client.post<ApiSuccess<IssuedLink>>(`/users/${id}/password-link`)),
    },
    organisations: crud<OrganisationDto, OrganisationBody>(client, '/organisations'),
    facilities: crud<FacilityDto, FacilityBody>(client, '/facilities'),
    communities: crud<CommunityDto, CommunityBody>(client, '/communities'),
    chws: {
      list: (params?: ListChwsParams) => client.get<ApiList<ChwDto>>('/chws', { query: q(params) }),
      get: (id: string) => client.getData<ChwDto>(`/chws/${id}`),
      create: (body: CreateChwBody) => data(client.post<ApiSuccess<CreatedChwResponse>>('/chws', body)),
      update: (id: string, body: UpdateChwBody) => data(client.patch<ApiSuccess<ChwDto>>(`/chws/${id}`, body)),
    },
    patients: {
      list: (params?: ListPatientsParams) => client.get<ApiList<PatientDto>>('/patients', { query: q(params) }),
      get: (id: string) => client.getData<PatientDto>(`/patients/${id}`),
      register: (body: RegisterPatientBody) => data(client.post<ApiSuccess<RegisterPatientResponse>>('/patients', body)),
      update: (id: string, body: UpdatePatientBody) => data(client.patch<ApiSuccess<PatientDto>>(`/patients/${id}`, body)),
      setStatus: (id: string, body: { status: PatientStatus; reason?: string | null; version: number }) =>
        data(client.post<ApiSuccess<PatientDto>>(`/patients/${id}/status`, body)),
      reassign: (id: string, assignedChwId: string, version: number) =>
        data(client.post<ApiSuccess<PatientDto>>(`/patients/${id}/reassign`, { assignedChwId, version })),
      consentHistory: (id: string) => client.getData<ConsentRecordDto[]>(`/patients/${id}/consent`),
      recordConsent: (id: string, body: ConsentBody & { version: number }) =>
        data(client.post<ApiSuccess<PatientDto>>(`/patients/${id}/consent`, body)),
      history: (id: string) => client.getData<PatientTimelineEntry[]>(`/patients/${id}/history`),
    },
    households: {
      list: (params?: { page?: number; pageSize?: number; q?: string; communityId?: string; organisationId?: string }) =>
        client.get<ApiList<HouseholdDto>>('/households', { query: q(params) }),
      get: (id: string) => client.getData<HouseholdWithMembers>(`/households/${id}`),
      create: (body: { communityId: string; headName?: string | null; landmark?: string | null; phone?: string | null; organisationId?: string | null }) =>
        data(client.post<ApiSuccess<HouseholdDto>>('/households', body)),
      update: (id: string, body: { headName?: string | null; landmark?: string | null; phone?: string | null; version: number }) =>
        data(client.patch<ApiSuccess<HouseholdDto>>(`/households/${id}`, body)),
    },
    referrals: {
      list: (params?: ListReferralsParams) => client.get<ApiList<ReferralDto>>('/referrals', { query: q(params) }),
      get: (id: string) => client.getData<ReferralDto>(`/referrals/${id}`),
      byCode: (code: string) => client.getData<ReferralDto>(`/referrals/code/${encodeURIComponent(code)}`),
      history: (id: string) => client.getData<ReferralEventDto[]>(`/referrals/${id}/history`),
      create: (body: CreateReferralBody) => data(client.post<ApiSuccess<CreatedReferralResponse>>('/referrals', body)),
      transition: (id: string, body: ReferralTransitionBody) => data(client.patch<ApiSuccess<ReferralDto>>(`/referrals/${id}/status`, body)),
      setPriority: (id: string, priority: ReferralPriority, version: number) =>
        data(client.patch<ApiSuccess<ReferralDto>>(`/referrals/${id}/priority`, { priority, version })),
    },
    referralTemplates: {
      list: (params?: { page?: number; pageSize?: number; status?: TemplateStatus; q?: string; organisationId?: string }) =>
        client.get<ApiList<InstructionTemplateDto>>('/referral-templates', { query: q(params) }),
      create: (body: { title: string; body: string; bodyHa?: string | null; organisationId?: string | null }) =>
        data(client.post<ApiSuccess<InstructionTemplateDto>>('/referral-templates', body)),
      update: (id: string, body: { title?: string; body?: string; bodyHa?: string | null; status?: 'retired'; version: number }) =>
        data(client.patch<ApiSuccess<InstructionTemplateDto>>(`/referral-templates/${id}`, body)),
      approve: (id: string, body: { reviewerName: string; reviewerCredentials: string; approvedOn: string; version: number }) =>
        data(client.post<ApiSuccess<InstructionTemplateDto>>(`/referral-templates/${id}/approve`, body)),
    },
    settings: {
      get: (organisationId?: string) => client.getData<ProgrammeSettingsDto>('/settings', { query: q({ organisationId }) }),
      save: (body: SettingsBody, organisationId?: string) =>
        data(client.request<ApiSuccess<ProgrammeSettingsDto>>('PUT', '/settings', { body, query: q({ organisationId }) })),
    },
    auditLogs: {
      list: (params?: ListAuditParams) => client.get<ApiList<AuditLogDto>>('/audit-logs', { query: q(params) }),
    },
    analytics: {
      overview: (organisationId?: string) => client.getData<OverviewDto>('/analytics/overview', { query: q({ organisationId }) }),
    },
  };
}

export type CaretrailApi = ReturnType<typeof createCaretrailApi>;

// ── Phase 6: appointments and follow-ups ────────────────────────────────────────

export interface ListAppointmentsParams {
  page?: number;
  pageSize?: number;
  status?: string;
  from?: string;
  to?: string;
  facilityId?: string;
  patientId?: string;
  category?: AppointmentCategory;
  sort?: 'scheduledFor' | '-scheduledFor';
  organisationId?: string;
}

export interface ListFollowUpsParams {
  page?: number;
  pageSize?: number;
  status?: string;
  open?: 'true';
  overdue?: 'true';
  reason?: FollowUpReason;
  assignedChwId?: string;
  patientId?: string;
  organisationId?: string;
}

/** Appointment and follow-up endpoints (kept separate so existing callers are unchanged). */
export function createCareApi(client: ApiClient) {
  const one = async <T>(p: Promise<ApiSuccess<T>>) => (await p).data;
  const qs = (params?: object) => params as Record<string, QueryValue> | undefined;
  return {
    appointments: {
      list: (params?: ListAppointmentsParams) => client.get<ApiList<AppointmentDto>>('/appointments', { query: qs(params) }),
      create: (body: { clientId?: string; patientId: string; facilityId?: string | null; category: AppointmentCategory; scheduledFor: string }) =>
        one(client.post<ApiSuccess<AppointmentDto>>('/appointments', body)),
      reschedule: (id: string, scheduledFor: string, version: number) => one(client.patch<ApiSuccess<AppointmentDto>>(`/appointments/${id}`, { scheduledFor, version })),
      cancel: (id: string, reason: string, version: number) => one(client.post<ApiSuccess<AppointmentDto>>(`/appointments/${id}/cancel`, { reason, version })),
      attendance: (id: string, outcome: 'attended' | 'missed', version: number) =>
        one(client.post<ApiSuccess<AppointmentDto>>(`/appointments/${id}/attendance`, { outcome, version })),
    },
    followUps: {
      list: (params?: ListFollowUpsParams) => client.get<ApiList<FollowUpTaskDto>>('/follow-ups', { query: qs(params) }),
      get: (id: string) => client.getData<FollowUpTaskDto>(`/follow-ups/${id}`),
      create: (body: { clientId?: string; patientId: string; dueOn: string; note: string }) => one(client.post<ApiSuccess<FollowUpTaskDto>>('/follow-ups', body)),
      attempt: (id: string, body: { method: ContactMethod; reached: boolean; response?: string | null; version: number }) =>
        one(client.post<ApiSuccess<FollowUpTaskDto>>(`/follow-ups/${id}/attempts`, body)),
      resolve: (id: string, body: { outcome: string; nextAction?: string | null; version: number }) => one(client.post<ApiSuccess<FollowUpTaskDto>>(`/follow-ups/${id}/resolve`, body)),
      escalate: (id: string, notes: string, version: number) => one(client.post<ApiSuccess<FollowUpTaskDto>>(`/follow-ups/${id}/escalate`, { notes, version })),
      runMissedCare: (organisationId?: string) =>
        one(client.post<ApiSuccess<MissedCareRunResult>>('/follow-ups/missed-care/run', undefined, { query: qs({ organisationId }) })),
    },
  };
}
