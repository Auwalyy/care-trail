import type {
  ApiList,
  ApiSuccess,
  AuthClient,
  AuthenticatedUser,
  CommunityDto,
  CreatedUserResponse,
  FacilityDto,
  IssuedLink,
  Language,
  LoginResponse,
  OrganisationDto,
  Role,
  UserDto,
  UserStatus,
} from '@caretrail/shared-types';
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
    organisations: {
      list: (params?: DirectoryParams) => client.get<ApiList<OrganisationDto>>('/organisations', { query: q(params) }),
    },
    facilities: {
      list: (params?: DirectoryParams) => client.get<ApiList<FacilityDto>>('/facilities', { query: q(params) }),
    },
    communities: {
      list: (params?: DirectoryParams) => client.get<ApiList<CommunityDto>>('/communities', { query: q(params) }),
    },
  };
}

export type CaretrailApi = ReturnType<typeof createCaretrailApi>;
