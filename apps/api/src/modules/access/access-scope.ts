import type { Types } from 'mongoose';
import { AppError } from '../../utils/app-error.js';
import type { UserDoc } from '../users/user.model.js';

/**
 * The data boundary for a signed-in user. Every repository query over tenant data takes a scope,
 * so isolation is enforced in one place on the server — never by frontend filtering.
 */
export type AccessScope =
  | { kind: 'platform' }
  | { kind: 'organisation'; organisationId: Types.ObjectId }
  | { kind: 'facility'; organisationId: Types.ObjectId; facilityId: Types.ObjectId }
  | {
      kind: 'chw';
      organisationId: Types.ObjectId;
      userId: Types.ObjectId;
      communityIds: Types.ObjectId[];
    };

export function buildAccessScope(user: Pick<UserDoc, '_id' | 'role' | 'organisationId' | 'facilityId' | 'communityIds'>): AccessScope {
  if (user.role === 'platform_admin') return { kind: 'platform' };
  if (!user.organisationId) throw new AppError('FORBIDDEN', 'Account is not linked to an organisation');
  switch (user.role) {
    case 'programme_admin':
      return { kind: 'organisation', organisationId: user.organisationId };
    case 'facility_admin':
    case 'facility_worker':
      if (!user.facilityId) throw new AppError('FORBIDDEN', 'Account is not linked to a facility');
      return { kind: 'facility', organisationId: user.organisationId, facilityId: user.facilityId };
    case 'chw':
      return {
        kind: 'chw',
        organisationId: user.organisationId,
        userId: user._id,
        communityIds: user.communityIds ?? [],
      };
  }
}

/** Organisation the scope is confined to, or null for platform scope. */
export function scopeOrganisationId(scope: AccessScope): Types.ObjectId | null {
  return scope.kind === 'platform' ? null : scope.organisationId;
}
