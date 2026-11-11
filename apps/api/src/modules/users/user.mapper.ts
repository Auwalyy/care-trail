import type { UserDto } from '@caretrail/shared-types';
import type { UserDoc } from './user.model.js';

/** The only way user documents leave the API. Credentials and lockout state are never exposed. */
export function toUserDto(user: UserDoc): UserDto {
  return {
    id: String(user._id),
    email: user.email,
    fullName: user.fullName,
    phone: user.phone ?? null,
    role: user.role,
    status: user.status,
    organisationId: user.organisationId ? String(user.organisationId) : null,
    facilityId: user.facilityId ? String(user.facilityId) : null,
    communityIds: (user.communityIds ?? []).map(String),
    preferredLanguage: user.preferredLanguage,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    version: user.version,
  };
}
