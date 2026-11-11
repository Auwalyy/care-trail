import type { QueryFilter } from 'mongoose';
import type { FacilityDto } from '@caretrail/shared-types';
import type { DirectoryListQuery } from '@caretrail/validation';
import { escapeRegex, findPaged } from '../../utils/paging.js';
import { scopeOrganisationId, type AccessScope } from '../access/access-scope.js';
import { FacilityModel, type FacilityDoc } from './facility.model.js';

export function toFacilityDto(f: FacilityDoc): FacilityDto {
  return {
    id: String(f._id),
    organisationId: String(f.organisationId),
    name: f.name,
    code: f.code,
    type: f.type,
    lga: f.lga,
    ward: f.ward ?? null,
    status: f.status,
  };
}

export class FacilityRepository {
  /** Facilities are visible organisation-wide (CHWs refer to any facility in their programme). */
  async list(scope: AccessScope, query: DirectoryListQuery) {
    const orgId = scopeOrganisationId(scope);
    const filter: QueryFilter<FacilityDoc> = { deletedAt: null };
    if (orgId) filter.organisationId = orgId;
    else if (query.organisationId) filter.organisationId = query.organisationId;
    if (query.status) filter.status = query.status;
    if (query.q) filter.name = new RegExp(escapeRegex(query.q), 'i');
    const { items, total } = await findPaged(FacilityModel, filter, { ...query, sort: { name: 1 } });
    return { items: items.map(toFacilityDto), total };
  }
}
