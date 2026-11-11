import { Types } from 'mongoose';
import type { CommunityDto } from '@caretrail/shared-types';
import type { CreateCommunityInput, DirectoryListQuery, UpdateCommunityInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { changedFields, duplicateAs, updateVersioned } from '../../utils/versioned.js';
import { resolveTargetOrganisation, withinScope } from '../access/access-scope.js';
import type { AuditService } from '../audit/audit.service.js';
import { UserModel } from '../users/user.model.js';
import { CommunityModel } from './community.model.js';
import { communityScopeFilter, toCommunityDto, type CommunityRepository } from './community.repository.js';

export class CommunityService {
  constructor(private readonly deps: { repo: CommunityRepository; audit: AuditService }) {}

  list(auth: AuthContext, query: DirectoryListQuery) {
    return this.deps.repo.list(auth.scope, query);
  }

  async get(auth: AuthContext, id: string): Promise<CommunityDto> {
    const c = Types.ObjectId.isValid(id) ? await this.deps.repo.findInScope(auth.scope, id) : null;
    if (!c) throw AppError.notFound('Community');
    return toCommunityDto(c);
  }

  async create(auth: AuthContext, input: CreateCommunityInput, ctx: RequestContext): Promise<CommunityDto> {
    const organisationId = await resolveTargetOrganisation(auth.scope, input.organisationId);
    const community = await this.deps.repo
      .create({ organisationId, name: input.name, lga: input.lga, ward: input.ward ?? null })
      .catch(duplicateAs('name', 'A community with this name already exists in this LGA'));
    await this.deps.audit.record({ action: 'community.create', auth, organisationId, entityType: 'community', entityId: community._id }, ctx);
    return toCommunityDto(community);
  }

  async update(auth: AuthContext, id: string, input: UpdateCommunityInput, ctx: RequestContext): Promise<CommunityDto> {
    const { version, ...changes } = input;
    await this.get(auth, id); // scope check first — never reveal anything about out-of-scope records
    if (changes.status === 'inactive') {
      const chws = await UserModel.countDocuments({ communityIds: id, status: { $ne: 'inactive' } });
      if (chws > 0) throw new AppError('CONFLICT', `Reassign the ${chws} community health worker(s) serving this community first.`);
    }
    const updated = await updateVersioned(CommunityModel, withinScope({ _id: id }, communityScopeFilter(auth.scope)), version, { $set: changes }, toCommunityDto)
      .catch(duplicateAs('name', 'A community with this name already exists in this LGA'));
    await this.deps.audit.record(
      { action: changes.status === 'inactive' ? 'community.deactivate' : 'community.update', auth, organisationId: updated.organisationId, entityType: 'community', entityId: updated._id, metadata: { fields: changedFields(changes) } },
      ctx,
    );
    return toCommunityDto(updated);
  }
}
