import type { QueryFilter } from 'mongoose';
import type { FacilityDto } from '@caretrail/shared-types';
import type { DirectoryListQuery } from '@caretrail/validation';
import { escapeRegex, findPaged } from '../../utils/paging.js';
import { organisationFilter, type AccessScope, withinScope } from '../access/access-scope.js';
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
    address: f.address ?? null,
    phone: f.phone ?? null,
    status: f.status,
    version: f.version,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

/** Facilities are visible organisation-wide (CHWs refer to any facility in their programme). */
export function facilityScopeFilter(scope: AccessScope, requestedOrg?: string): QueryFilter<FacilityDoc> {
  return { deletedAt: null, ...organisationFilter(scope, requestedOrg) };
}

export class FacilityRepository {
  async list(scope: AccessScope, query: DirectoryListQuery) {
    const filter: QueryFilter<FacilityDoc> = facilityScopeFilter(scope, query.organisationId);
    if (query.status) filter.status = query.status;
    if (query.q) {
      const re = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: re }, { code: re }, { lga: re }];
    }
    const { items, total } = await findPaged(FacilityModel, filter, { ...query, sort: { name: 1 } });
    return { items: items.map(toFacilityDto), total };
  }

  findInScope(scope: AccessScope, id: string) {
    return FacilityModel.findOne(withinScope<FacilityDoc>({ _id: id }, facilityScopeFilter(scope))).lean<FacilityDoc>();
  }

  async create(doc: Partial<FacilityDoc>): Promise<FacilityDoc> {
    return (await FacilityModel.create(doc)).toObject();
  }
}
