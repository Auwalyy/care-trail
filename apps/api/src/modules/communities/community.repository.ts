import type { QueryFilter } from 'mongoose';
import type { CommunityDto } from '@caretrail/shared-types';
import type { DirectoryListQuery } from '@caretrail/validation';
import { escapeRegex, findPaged } from '../../utils/paging.js';
import { scopeOrganisationId, type AccessScope } from '../access/access-scope.js';
import { CommunityModel, type CommunityDoc } from './community.model.js';

export function toCommunityDto(c: CommunityDoc): CommunityDto {
  return {
    id: String(c._id),
    organisationId: String(c.organisationId),
    name: c.name,
    lga: c.lga,
    ward: c.ward ?? null,
    status: c.status,
  };
}

export class CommunityRepository {
  async list(scope: AccessScope, query: DirectoryListQuery) {
    const orgId = scopeOrganisationId(scope);
    const filter: QueryFilter<CommunityDoc> = { deletedAt: null };
    if (orgId) filter.organisationId = orgId;
    else if (query.organisationId) filter.organisationId = query.organisationId;
    if (query.status) filter.status = query.status;
    if (query.q) filter.name = new RegExp(escapeRegex(query.q), 'i');
    const { items, total } = await findPaged(CommunityModel, filter, { ...query, sort: { lga: 1, name: 1 } });
    return { items: items.map(toCommunityDto), total };
  }
}
