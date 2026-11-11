import type {
  ApiList,
  ApiSuccess,
  AuditLogDto,
  AuthClient,
  AuthenticatedUser,
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
