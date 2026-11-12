import type { Language, UserStatus } from './enums.js';
import type { Permission } from './permissions.js';
import type { Role } from './roles.js';

/** Public user representation returned by the API (never includes credentials). */
export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  organisationId: string | null;
  facilityId: string | null;
  communityIds: string[];
  preferredLanguage: Language;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AuthenticatedUser extends UserDto {
  permissions: Permission[];
}

export type AuthClient = 'web' | 'mobile';

export interface LoginResponse {
  accessToken: string;
  /** ISO timestamp when the access token expires. */
  accessTokenExpiresAt: string;
  /** Only returned to mobile clients; web clients receive an httpOnly cookie instead. */
  refreshToken?: string;
  refreshTokenExpiresAt: string;
  user: AuthenticatedUser;
}

/** Returned once when an administrator creates a user or issues a reset link. */
export interface IssuedLink {
  url: string;
  expiresAt: string;
}

export interface CreatedUserResponse {
  user: UserDto;
  activation: IssuedLink;
}

/**
 * Which roles each role may create and manage. Enforced by the API together with scope rules:
 * programme admins only within their organisation, facility admins only within their facility.
 * Platform admins create programme administrators; nobody can create a platform admin through
 * the API (bootstrap script only).
 */
export const MANAGEABLE_ROLES: Record<Role, readonly Role[]> = {
  platform_admin: ['programme_admin', 'facility_admin', 'facility_worker', 'chw'],
  programme_admin: ['facility_admin', 'facility_worker', 'chw'],
  facility_admin: ['facility_worker'],
  facility_worker: [],
  chw: [],
};

export function canManageRole(actor: Role, target: Role): boolean {
  return MANAGEABLE_ROLES[actor].includes(target);
}

/** Roles that must be attached to a facility / organisation / communities. */
export const ROLE_REQUIREMENTS: Record<
  Role,
  { organisation: boolean; facility: boolean; communities: boolean }
> = {
  platform_admin: { organisation: false, facility: false, communities: false },
  programme_admin: { organisation: true, facility: false, communities: false },
  facility_admin: { organisation: true, facility: true, communities: false },
  facility_worker: { organisation: true, facility: true, communities: false },
  chw: { organisation: true, facility: false, communities: true },
};

/** Where each role lands after signing in to the web app. */
export function webLandingPath(role: Role): string {
  if (role === 'chw') return '/profile';
  // Facility staff start at their incoming referral queue.
  if (role === 'facility_admin' || role === 'facility_worker') return '/referrals';
  return '/dashboard';
}
