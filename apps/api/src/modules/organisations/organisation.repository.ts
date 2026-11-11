import type { QueryFilter } from 'mongoose';
import type { OrganisationDto } from '@caretrail/shared-types';
import type { DirectoryListQuery } from '@caretrail/validation';
import { escapeRegex, findPaged } from '../../utils/paging.js';
import type { AccessScope } from '../access/access-scope.js';
import { OrganisationModel, type OrganisationDoc } from './organisation.model.js';

export function toOrganisationDto(o: OrganisationDoc): OrganisationDto {
  return { id: String(o._id), name: o.name, code: o.code, state: o.state, status: o.status };
}

export class OrganisationRepository {
  async list(scope: AccessScope, query: DirectoryListQuery) {
    const filter: QueryFilter<OrganisationDoc> = scope.kind === 'platform' ? {} : { _id: scope.organisationId };
    if (query.status) filter.status = query.status;
    if (query.q) filter.name = new RegExp(escapeRegex(query.q), 'i');
    const { items, total } = await findPaged(OrganisationModel, filter, { ...query, sort: { name: 1 } });
    return { items: items.map(toOrganisationDto), total };
  }
}
