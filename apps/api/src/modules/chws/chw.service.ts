import mongoose, { Types } from 'mongoose';
import type { ChwDto, CreatedChwResponse } from '@caretrail/shared-types';
import type { CreateChwInput, ListChwsQuery, UpdateChwInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { changedFields, updateVersioned } from '../../utils/versioned.js';
import { resolveTargetOrganisation } from '../access/access-scope.js';
import type { AuditService } from '../audit/audit.service.js';
import { UserModel, type UserDoc } from '../users/user.model.js';
import type { UserService } from '../users/user.service.js';
import { ChwProfileModel, type ChwProfileDoc } from './chw.model.js';
import { toChwDto, type ChwRepository } from './chw.repository.js';

const SUPERVISOR_ROLES = ['programme_admin', 'facility_admin', 'facility_worker'] as const;

export class ChwService {
  constructor(private readonly deps: { repo: ChwRepository; users: UserService; audit: AuditService }) {}

  list(auth: AuthContext, query: ListChwsQuery) {
    return this.deps.repo.list(auth.scope, query);
  }

  async get(auth: AuthContext, id: string): Promise<ChwDto> {
    const found = Types.ObjectId.isValid(id) ? await this.deps.repo.findInScope(auth.scope, id) : null;
    if (!found) throw AppError.notFound('Community health worker');
    return toChwDto(found.user, found.profile);
  }

  async create(auth: AuthContext, input: CreateChwInput, ctx: RequestContext): Promise<CreatedChwResponse> {
    const organisationId = await resolveTargetOrganisation(auth.scope, input.organisationId);
    const supervisorUserId = await this.validateSupervisor(organisationId, input.supervisorUserId);
    const created = await this.deps.users.create(
      auth,
      {
        email: input.email,
        fullName: input.fullName,
        phone: input.phone ?? null,
        preferredLanguage: input.preferredLanguage,
        role: 'chw',
        organisationId: String(organisationId),
        facilityId: null,
        communityIds: input.communityIds,
      },
      ctx,
      { programmeAreas: input.programmeAreas, canIssueReferrals: input.canIssueReferrals, supervisorUserId },
    );
    return { chw: await this.get(auth, created.user.id), activation: created.activation };
  }

  async update(auth: AuthContext, id: string, input: UpdateChwInput, ctx: RequestContext): Promise<ChwDto> {
    const current = await this.deps.repo.findInScope(auth.scope, id);
    if (!current) throw AppError.notFound('Community health worker');
    const { user } = current;
    const organisationId = user.organisationId as Types.ObjectId;
    const { version, communityIds, ...profileChanges } = input;

    const $set: Partial<ChwProfileDoc> = {};
    if (profileChanges.programmeAreas !== undefined) $set.programmeAreas = profileChanges.programmeAreas;
    if (profileChanges.canIssueReferrals !== undefined) $set.canIssueReferrals = profileChanges.canIssueReferrals;
    if (profileChanges.supervisorUserId !== undefined) {
      $set.supervisorUserId = await this.validateSupervisor(organisationId, profileChanges.supervisorUserId);
    }
    const assignment = communityIds
      ? await this.deps.users.resolveAssignment(auth, 'chw', { organisationId, facilityId: null, communityIds })
      : null;

    await mongoose.connection.transaction(async (session) => {
      await updateVersioned(ChwProfileModel, { userId: user._id }, version, { $set }, (p) => toChwDto(user, p), session);
      if (assignment) {
        await UserModel.updateOne(
          { _id: user._id },
          { $set: { communityIds: assignment.communityIds, updatedBy: auth.userId }, $inc: { version: 1 } },
          { session },
        );
      }
      await this.deps.audit.record(
        { action: 'chw.update', auth, organisationId, entityType: 'user', entityId: user._id, metadata: { fields: changedFields(input) }, session },
        ctx,
      );
    });
    return this.get(auth, id);
  }

  private async validateSupervisor(organisationId: Types.ObjectId, supervisorId: string | null | undefined): Promise<Types.ObjectId | null> {
    if (!supervisorId) return null;
    const sup = await UserModel.findOne({
      _id: supervisorId,
      organisationId,
      role: { $in: SUPERVISOR_ROLES },
      status: 'active',
    }).lean<UserDoc>();
    if (!sup) {
      throw new AppError('VALIDATION_ERROR', 'Supervisor must be an active staff member of this organisation', [
        { path: 'supervisorUserId', message: 'Choose an active programme or facility staff member' },
      ]);
    }
    return sup._id;
  }
}
