import type { QueryFilter } from 'mongoose';
import type { OrganisationDto } from '@caretrail/shared-types';
import type { DirectoryListQuery } from '@caretrail/validation';
import { escapeRegex, findPaged } from '../../utils/paging.js';
import type { AccessScope } from '../access/access-scope.js';
import { OrganisationModel, type OrganisationDoc } from './organisation.model.js';
import { withinScope } from '../access/access-scope.js';

export function toOrganisationDto(o: OrganisationDoc): OrganisationDto {
  return {
    id: String(o._id),
    name: o.name,
    code: o.code,
    state: o.state,
    contactEmail: o.contactEmail ?? null,
    status: o.status,
    version: o.version,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function organisationScopeFilter(scope: AccessScope): QueryFilter<OrganisationDoc> {
  return scope.kind === 'platform' ? {} : { _id: scope.organisationId };
}

export class OrganisationRepository {
  async list(scope: AccessScope, query: DirectoryListQuery) {
    const filter: QueryFilter<OrganisationDoc> = { ...organisationScopeFilter(scope) };
    if (query.status) filter.status = query.status;
    if (query.q) filter.name = new RegExp(escapeRegex(query.q), 'i');
    const { items, total } = await findPaged(OrganisationModel, filter, { ...query, sort: { name: 1 } });
    return { items: items.map(toOrganisationDto), total };
  }

  findInScope(scope: AccessScope, id: string) {
    return OrganisationModel.findOne(withinScope<OrganisationDoc>({ _id: id }, organisationScopeFilter(scope))).lean<OrganisationDoc>();
  }

  async create(doc: Partial<OrganisationDoc>): Promise<OrganisationDoc> {
    return (await OrganisationModel.create(doc)).toObject();
  }
}
