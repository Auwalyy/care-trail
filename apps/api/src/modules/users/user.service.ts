import mongoose, { Types } from 'mongoose';
import {
  ROLE_REQUIREMENTS,
  canManageRole,
  type CreatedUserResponse,
  type IssuedLink,
  type Role,
  type UserDto,
} from '@caretrail/shared-types';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthService } from '../auth/auth.service.js';
import { LINK_TTL_MS, type PasswordLinkService } from '../auth/password-link.service.js';
import { CommunityModel } from '../communities/community.model.js';
import { FacilityModel } from '../facilities/facility.model.js';
import { OrganisationModel } from '../organisations/organisation.model.js';
import { toUserDto } from './user.mapper.js';
import { UserModel, type UserDoc } from './user.model.js';
import type { UserRepository } from './user.repository.js';

interface Assignment {
  organisationId: Types.ObjectId | null;
  facilityId: Types.ObjectId | null;
  communityIds: Types.ObjectId[];
}

const oid = (v: string | Types.ObjectId) => (typeof v === 'string' ? new Types.ObjectId(v) : v);
const same = (a?: Types.ObjectId | null, b?: Types.ObjectId | null) => Boolean(a && b && a.equals(b));

export class UserService {
  constructor(
    private readonly deps: {
      repo: UserRepository;
      audit: AuditService;
      auth: AuthService;
      links: PasswordLinkService;
      now?: () => Date;
    },
  ) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  async list(auth: AuthContext, query: ListUsersQuery) {
    const { items, total } = await this.deps.repo.list(auth.scope, query);
    return { items: items.map(toUserDto), total };
  }

  async get(auth: AuthContext, id: string): Promise<UserDto> {
    return toUserDto(await this.findVisible(auth, id));
  }

  async create(auth: AuthContext, input: CreateUserInput, ctx: RequestContext): Promise<CreatedUserResponse> {
    this.assertCanManageRole(auth, input.role);
    const assignment = await this.resolveAssignment(auth, input.role, {
      organisationId: input.organisationId ?? null,
      facilityId: input.facilityId ?? null,
      communityIds: input.communityIds,
    });
    const now = this.now();

    let result: CreatedUserResponse | undefined;
    await mongoose.connection.transaction(async (session) => {
      const user = await this.deps.repo
        .create(
          {
            email: input.email,
            fullName: input.fullName,
            phone: input.phone ?? null,
            role: input.role,
            status: 'pending_activation',
            preferredLanguage: input.preferredLanguage,
            ...assignment,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
          session,
        )
        .catch((err: unknown) => {
          if ((err as { code?: number }).code === 11000) {
            throw AppError.conflict('A user with this email already exists', [{ path: 'email', message: 'Already in use' }]);
          }
          throw err;
        });
      const activation = await this.deps.links.issue(
        { userId: user._id, purpose: 'activation', ttlMs: LINK_TTL_MS.activation, issuedBy: auth.userId },
        now,
        session,
      );
      await this.deps.audit.record(
        { action: 'user.create', auth, entityType: 'user', entityId: user._id, organisationId: assignment.organisationId, metadata: { role: user.role }, session },
        ctx,
      );
      result = { user: toUserDto(user), activation };
    });
    return result!;
  }

  async update(auth: AuthContext, id: string, input: UpdateUserInput, ctx: RequestContext): Promise<UserDto> {
    const target = await this.findManageable(auth, id);
    const assignment =
      input.facilityId !== undefined || input.communityIds !== undefined
        ? await this.resolveAssignment(auth, target.role, {
            organisationId: target.organisationId ?? null,
            facilityId: input.facilityId !== undefined ? input.facilityId : target.facilityId ? String(target.facilityId) : null,
            communityIds: input.communityIds ?? target.communityIds.map(String),
          })
        : null;

    const $set: Partial<UserDoc> = { updatedBy: auth.userId };
    if (input.fullName !== undefined) $set.fullName = input.fullName;
    if (input.phone !== undefined) $set.phone = input.phone;
    if (input.preferredLanguage !== undefined) $set.preferredLanguage = input.preferredLanguage;
    if (assignment) {
      $set.facilityId = assignment.facilityId;
      $set.communityIds = assignment.communityIds;
    }

    const updated = await this.deps.repo.updateVersioned(target._id, input.version, { $set });
    if (!updated) throw this.versionConflict(target);
    await this.deps.audit.record(
      { action: 'user.update', auth, entityType: 'user', entityId: target._id, organisationId: target.organisationId ?? null, metadata: { fields: Object.keys($set).filter((k) => k !== 'updatedBy') } },
      ctx,
    );
    return toUserDto(updated);
  }

  async setStatus(
    auth: AuthContext,
    id: string,
    input: { status: 'active' | 'inactive'; version: number },
    ctx: RequestContext,
  ): Promise<UserDto> {
    const target = await this.findManageable(auth, id);
    if (target.status === input.status) return toUserDto(target);
    if (input.status === 'active' && target.status === 'pending_activation') {
      throw new AppError('CONFLICT', 'This user has not activated their account yet. Issue a new activation link instead.');
    }

    let updated: UserDoc | null = null;
    await mongoose.connection.transaction(async (session) => {
      // Reactivating a deactivated user who never set a password returns them to pending.
      const hasPassword = await UserModel.exists({ _id: target._id, passwordHash: { $exists: true } }).session(session);
      const status = input.status === 'active' && !hasPassword ? 'pending_activation' : input.status;
      updated = await this.deps.repo.updateVersioned(target._id, input.version, { $set: { status, updatedBy: auth.userId } }, session);
      if (!updated) throw this.versionConflict(target);
      if (input.status === 'inactive') await this.deps.auth.revokeAllSessions(target._id, session);
      await this.deps.audit.record(
        { action: input.status === 'inactive' ? 'user.deactivate' : 'user.reactivate', auth, entityType: 'user', entityId: target._id, organisationId: target.organisationId ?? null, session },
        ctx,
      );
    });
    return toUserDto(updated!);
  }

  /** Issues a reset link (active users) or a new activation link (pending users) for hand-over. */
  async issuePasswordLink(auth: AuthContext, id: string, ctx: RequestContext): Promise<IssuedLink> {
    const target = await this.findManageable(auth, id);
    if (target.status === 'inactive') throw new AppError('CONFLICT', 'Reactivate the user before issuing a link.');
    const purpose = target.status === 'pending_activation' ? 'activation' : 'reset';
    const link = await this.deps.links.issue(
      { userId: target._id, purpose, ttlMs: purpose === 'activation' ? LINK_TTL_MS.activation : LINK_TTL_MS.admin_reset, issuedBy: auth.userId },
      this.now(),
    );
    await this.deps.audit.record(
      { action: 'user.password_link_issued', auth, entityType: 'user', entityId: target._id, organisationId: target.organisationId ?? null, metadata: { purpose } },
      ctx,
    );
    return link;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private async findVisible(auth: AuthContext, id: string): Promise<UserDoc> {
    if (!Types.ObjectId.isValid(id)) throw AppError.notFound('User');
    const user = await this.deps.repo.findInScope(auth.scope, id);
    if (!user) throw AppError.notFound('User');
    return user;
  }

  private async findManageable(auth: AuthContext, id: string): Promise<UserDoc> {
    const target = await this.findVisible(auth, id);
    if (target._id.equals(auth.userId)) throw AppError.forbidden('You cannot change your own account here.');
    this.assertCanManageRole(auth, target.role);
    return target;
  }

  private assertCanManageRole(auth: AuthContext, role: Role) {
    if (!canManageRole(auth.role, role)) throw AppError.forbidden(`You cannot manage ${role.replace('_', ' ')} accounts.`);
  }

  private versionConflict(current: UserDoc) {
    return new AppError('VERSION_CONFLICT', 'This user was changed by someone else. Reload and try again.', {
      current: toUserDto(current),
    });
  }

  /**
   * Validates organisation / facility / community links for a role, forcing them to the actor's
   * own organisation or facility where the actor is confined to one.
   */
  private async resolveAssignment(
    auth: AuthContext,
    role: Role,
    input: { organisationId: string | Types.ObjectId | null; facilityId: string | Types.ObjectId | null; communityIds: (string | Types.ObjectId)[] },
  ): Promise<Assignment> {
    const req = ROLE_REQUIREMENTS[role];
    const scope = auth.scope;
    const invalid = (path: string, message: string) => new AppError('VALIDATION_ERROR', message, [{ path, message }]);

    // Organisation
    let organisationId: Types.ObjectId | null = null;
    if (req.organisation) {
      if (scope.kind === 'platform') {
        if (!input.organisationId) throw invalid('organisationId', 'Select an organisation');
        organisationId = oid(input.organisationId);
      } else {
        if (input.organisationId && !oid(input.organisationId).equals(scope.organisationId)) {
          throw AppError.forbidden('You can only manage users in your own organisation.');
        }
        organisationId = scope.organisationId;
      }
      const org = await OrganisationModel.findOne({ _id: organisationId, status: 'active' }).lean();
      if (!org) throw invalid('organisationId', 'Organisation not found or inactive');
    } else if (input.organisationId) {
      throw invalid('organisationId', 'This role is not linked to an organisation');
    }

    // Facility
    let facilityId: Types.ObjectId | null = null;
    if (req.facility) {
      const requested = input.facilityId ? oid(input.facilityId) : scope.kind === 'facility' ? scope.facilityId : null;
      if (!requested) throw invalid('facilityId', 'Select a facility');
      if (scope.kind === 'facility' && !same(requested, scope.facilityId)) {
        throw AppError.forbidden('You can only manage users in your own facility.');
      }
      const facility = await FacilityModel.findOne({ _id: requested, organisationId, status: 'active', deletedAt: null }).lean();
      if (!facility) throw invalid('facilityId', 'Facility not found in this organisation');
      facilityId = requested;
    } else if (input.facilityId) {
      throw invalid('facilityId', 'This role is not linked to a facility');
    }

    // Communities
    let communityIds: Types.ObjectId[] = [];
    if (req.communities) {
      communityIds = [...new Set(input.communityIds.map(String))].map((v) => new Types.ObjectId(v));
      if (communityIds.length === 0) throw invalid('communityIds', 'Assign at least one community');
      const found = await CommunityModel.countDocuments({ _id: { $in: communityIds }, organisationId, deletedAt: null });
      if (found !== communityIds.length) throw invalid('communityIds', 'One or more communities were not found in this organisation');
    } else if (input.communityIds.length > 0) {
      throw invalid('communityIds', 'This role is not linked to communities');
    }

    return { organisationId, facilityId, communityIds };
  }
}
