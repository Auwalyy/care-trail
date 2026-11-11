import { Types } from 'mongoose';
import type { OrganisationDto } from '@caretrail/shared-types';
import type { CreateOrganisationInput, DirectoryListQuery, UpdateOrganisationInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { changedFields, duplicateAs, updateVersioned } from '../../utils/versioned.js';
import type { AuditService } from '../audit/audit.service.js';
import { UserModel } from '../users/user.model.js';
import { OrganisationModel } from './organisation.model.js';
import { organisationScopeFilter, toOrganisationDto, type OrganisationRepository } from './organisation.repository.js';
import { withinScope } from '../access/access-scope.js';

export class OrganisationService {
  constructor(private readonly deps: { repo: OrganisationRepository; audit: AuditService }) {}

  list(auth: AuthContext, query: DirectoryListQuery) {
    return this.deps.repo.list(auth.scope, query);
  }

  async get(auth: AuthContext, id: string): Promise<OrganisationDto> {
    const org = Types.ObjectId.isValid(id) ? await this.deps.repo.findInScope(auth.scope, id) : null;
    if (!org) throw AppError.notFound('Organisation');
    return toOrganisationDto(org);
  }

  async create(auth: AuthContext, input: CreateOrganisationInput, ctx: RequestContext): Promise<OrganisationDto> {
    const org = await this.deps.repo
      .create({ name: input.name, code: input.code, state: input.state, contactEmail: input.contactEmail ?? null })
      .catch(duplicateAs('code', 'An organisation with this code already exists'));
    await this.deps.audit.record({ action: 'organisation.create', auth, organisationId: org._id, entityType: 'organisation', entityId: org._id }, ctx);
    return toOrganisationDto(org);
  }

  async update(auth: AuthContext, id: string, input: UpdateOrganisationInput, ctx: RequestContext): Promise<OrganisationDto> {
    const { version, ...changes } = input;
    await this.get(auth, id); // scope check first
    if (changes.status === 'inactive') {
      const activeUsers = await UserModel.countDocuments({ organisationId: id, status: { $ne: 'inactive' } });
      if (activeUsers > 0) {
        throw new AppError('CONFLICT', `Deactivate or move the ${activeUsers} user account(s) in this organisation first.`);
      }
    }
    const filter = withinScope({ _id: id }, organisationScopeFilter(auth.scope));
    const updated = await updateVersioned(OrganisationModel, filter, version, { $set: changes }, toOrganisationDto);
    await this.deps.audit.record(
      { action: changes.status ? `organisation.${changes.status === 'inactive' ? 'deactivate' : 'update'}` : 'organisation.update', auth, organisationId: updated._id, entityType: 'organisation', entityId: updated._id, metadata: { fields: changedFields(changes) } },
      ctx,
    );
    return toOrganisationDto(updated);
  }
}
