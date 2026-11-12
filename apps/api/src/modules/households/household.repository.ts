import type { QueryFilter, Types } from 'mongoose';
import type { HouseholdDto } from '@caretrail/shared-types';
import type { ListHouseholdsQuery } from '@caretrail/validation';
import { escapeRegex, findPaged } from '../../utils/paging.js';
import { withinScope, type AccessScope } from '../access/access-scope.js';
import { HouseholdModel, type HouseholdDoc } from './household.model.js';

/** Households: org-wide for programme admins; a CHW's communities for CHWs; none for facilities. */
export function householdScopeFilter(scope: AccessScope): QueryFilter<HouseholdDoc> {
  const live = { deletedAt: null };
  switch (scope.kind) {
    case 'platform':
      return live;
    case 'organisation':
      return { ...live, organisationId: scope.organisationId };
    case 'chw':
      return { ...live, organisationId: scope.organisationId, communityId: { $in: scope.communityIds } };
    case 'facility':
      return { _id: { $in: [] } };
  }
}

export function toHouseholdDto(h: HouseholdDoc): HouseholdDto {
  return {
    id: String(h._id),
    householdCode: h.householdCode,
    organisationId: String(h.organisationId),
    communityId: String(h.communityId),
    headName: h.headName ?? null,
    landmark: h.landmark ?? null,
    phone: h.phone ?? null,
    version: h.version,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
  };
}

export class HouseholdRepository {
  async list(scope: AccessScope, query: ListHouseholdsQuery) {
    const filter: QueryFilter<HouseholdDoc> = {};
    if (scope.kind === 'platform' && query.organisationId) filter.organisationId = query.organisationId;
    if (query.communityId) filter.communityId = query.communityId;
    if (query.q) {
      const re = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ householdCode: re }, { headName: re }, { landmark: re }];
    }
    const { items, total } = await findPaged(HouseholdModel, withinScope(filter, householdScopeFilter(scope)), { ...query, sort: { householdCode: 1 } });
    return { items: items.map(toHouseholdDto), total };
  }

  findInScope(scope: AccessScope, id: string | Types.ObjectId) {
    return HouseholdModel.findOne(withinScope<HouseholdDoc>({ _id: id }, householdScopeFilter(scope))).lean<HouseholdDoc>();
  }
}
