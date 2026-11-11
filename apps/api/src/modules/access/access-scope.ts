import type { QueryFilter, Types } from 'mongoose';
import { AppError } from '../../utils/app-error.js';
import { OrganisationModel } from '../organisations/organisation.model.js';
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

/**
 * Organisation a write applies to. Platform admins must name one (it must exist and be active);
 * everyone else is pinned to their own and may not name another.
 */
export async function resolveTargetOrganisation(
  scope: AccessScope,
  requested: string | null | undefined,
): Promise<Types.ObjectId> {
  if (scope.kind !== 'platform') {
    if (requested && requested !== String(scope.organisationId)) {
      throw AppError.forbidden('You can only manage records in your own organisation.');
    }
    return scope.organisationId;
  }
  if (!requested) {
    throw new AppError('VALIDATION_ERROR', 'Select an organisation', [{ path: 'organisationId', message: 'Select an organisation' }]);
  }
  const org = await OrganisationModel.findOne({ _id: requested, status: 'active' }).select('_id').lean();
  if (!org) {
    throw new AppError('VALIDATION_ERROR', 'Organisation not found or inactive', [{ path: 'organisationId', message: 'Organisation not found or inactive' }]);
  }
  return org._id;
}

/**
 * Combines a record filter with a scope filter so that NEITHER can override the other.
 * Never spread a scope filter into an object that also sets `_id`: scope filters may themselves
 * key on `_id` (e.g. a programme admin's organisation, a CHW's own user), and object spread
 * silently replaces one condition with the other.
 */
export function withinScope<T>(record: QueryFilter<T>, scopeFilter: QueryFilter<T>): QueryFilter<T> {
  return { $and: [record, scopeFilter] } as QueryFilter<T>;
}

/** Filter fragment restricting organisation-owned records to the scope. */
export function organisationFilter(scope: AccessScope, requested?: string): { organisationId?: Types.ObjectId | string } {
  const own = scopeOrganisationId(scope);
  if (own) return { organisationId: own };
  return requested ? { organisationId: requested } : {};
}
