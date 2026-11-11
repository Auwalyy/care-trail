import { Types } from 'mongoose';
import type { FacilityDto } from '@caretrail/shared-types';
import type { CreateFacilityInput, DirectoryListQuery, UpdateFacilityInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { changedFields, duplicateAs, updateVersioned } from '../../utils/versioned.js';
import { resolveTargetOrganisation, withinScope } from '../access/access-scope.js';
import type { AuditService } from '../audit/audit.service.js';
import { UserModel } from '../users/user.model.js';
import { FacilityModel } from './facility.model.js';
import { facilityScopeFilter, toFacilityDto, type FacilityRepository } from './facility.repository.js';

export class FacilityService {
  constructor(private readonly deps: { repo: FacilityRepository; audit: AuditService }) {}

  list(auth: AuthContext, query: DirectoryListQuery) {
    return this.deps.repo.list(auth.scope, query);
  }

  async get(auth: AuthContext, id: string): Promise<FacilityDto> {
    const f = Types.ObjectId.isValid(id) ? await this.deps.repo.findInScope(auth.scope, id) : null;
    if (!f) throw AppError.notFound('Facility');
    return toFacilityDto(f);
  }

  async create(auth: AuthContext, input: CreateFacilityInput, ctx: RequestContext): Promise<FacilityDto> {
    const organisationId = await resolveTargetOrganisation(auth.scope, input.organisationId);
    const facility = await this.deps.repo
      .create({
        organisationId,
        name: input.name,
        code: input.code,
        type: input.type,
        lga: input.lga,
        ward: input.ward ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
      })
      .catch(duplicateAs('code', 'A facility with this code already exists in the organisation'));
    await this.deps.audit.record({ action: 'facility.create', auth, organisationId, entityType: 'facility', entityId: facility._id }, ctx);
    return toFacilityDto(facility);
  }

  async update(auth: AuthContext, id: string, input: UpdateFacilityInput, ctx: RequestContext): Promise<FacilityDto> {
    const { version, ...changes } = input;
    await this.get(auth, id); // scope check first — never reveal anything about out-of-scope records
    if (changes.status === 'inactive') {
      const staff = await UserModel.countDocuments({ facilityId: id, status: { $ne: 'inactive' } });
      if (staff > 0) throw new AppError('CONFLICT', `Move or deactivate the ${staff} staff account(s) at this facility first.`);
    }
    const updated = await updateVersioned(FacilityModel, withinScope({ _id: id }, facilityScopeFilter(auth.scope)), version, { $set: changes }, toFacilityDto);
    await this.deps.audit.record(
      { action: changes.status === 'inactive' ? 'facility.deactivate' : 'facility.update', auth, organisationId: updated.organisationId, entityType: 'facility', entityId: updated._id, metadata: { fields: changedFields(changes) } },
      ctx,
    );
    return toFacilityDto(updated);
  }
}
