import type { QueryFilter } from 'mongoose';
import type { CommunityDto } from '@caretrail/shared-types';
import type { DirectoryListQuery } from '@caretrail/validation';
import { escapeRegex, findPaged } from '../../utils/paging.js';
import { organisationFilter, type AccessScope, withinScope } from '../access/access-scope.js';
import { CommunityModel, type CommunityDoc } from './community.model.js';

export function toCommunityDto(c: CommunityDoc): CommunityDto {
  return {
    id: String(c._id),
    organisationId: String(c.organisationId),
    name: c.name,
    lga: c.lga,
    ward: c.ward ?? null,
    status: c.status,
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function communityScopeFilter(scope: AccessScope, requestedOrg?: string): QueryFilter<CommunityDoc> {
  return { deletedAt: null, ...organisationFilter(scope, requestedOrg) };
}

export class CommunityRepository {
  async list(scope: AccessScope, query: DirectoryListQuery) {
    const filter: QueryFilter<CommunityDoc> = communityScopeFilter(scope, query.organisationId);
    if (query.status) filter.status = query.status;
    if (query.q) {
      const re = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: re }, { lga: re }, { ward: re }];
    }
    const { items, total } = await findPaged(CommunityModel, filter, { ...query, sort: { lga: 1, name: 1 } });
    return { items: items.map(toCommunityDto), total };
  }

  findInScope(scope: AccessScope, id: string) {
    return CommunityModel.findOne(withinScope<CommunityDoc>({ _id: id }, communityScopeFilter(scope))).lean<CommunityDoc>();
  }

  async create(doc: Partial<CommunityDoc>): Promise<CommunityDoc> {
    return (await CommunityModel.create(doc)).toObject();
  }
}
