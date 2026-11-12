import mongoose, { Types, type ClientSession } from 'mongoose';
import type { HouseholdDto, HouseholdWithMembers } from '@caretrail/shared-types';
import type { CreateHouseholdInput, ListHouseholdsQuery, UpdateHouseholdInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { formatCode, nextSequence } from '../../utils/counters.js';
import { changedFields, updateVersioned } from '../../utils/versioned.js';
import { resolveTargetOrganisation, withinScope } from '../access/access-scope.js';
import type { AuditService } from '../audit/audit.service.js';
import { CommunityModel } from '../communities/community.model.js';
import { PatientModel, type PatientDoc } from '../patients/patient.model.js';
import { scopedPatientFilter } from '../patients/patient.repository.js';
import { HouseholdModel, type HouseholdDoc } from './household.model.js';
import { householdScopeFilter, toHouseholdDto, type HouseholdRepository } from './household.repository.js';

/**
 * Checks the caller may work in a community: it must be active in the organisation, and CHWs
 * may only work in communities they are assigned to.
 */
export async function assertCommunityUsable(auth: AuthContext, organisationId: Types.ObjectId, communityId: string | Types.ObjectId): Promise<void> {
  const community = await CommunityModel.findOne({ _id: communityId, organisationId, status: 'active', deletedAt: null }).select('_id').lean();
  if (!community) {
    throw new AppError('VALIDATION_ERROR', 'Community not found or inactive', [{ path: 'communityId', message: 'Choose an active community' }]);
  }
  if (auth.scope.kind === 'chw' && !auth.scope.communityIds.some((c) => c.equals(community._id))) {
    throw AppError.forbidden('You can only register people in your assigned communities.');
  }
}

/** Creates a household with a server-generated code. Used directly and during registration. */
export async function insertHousehold(
  params: { organisationId: Types.ObjectId; communityId: Types.ObjectId; headName?: string | null; landmark?: string | null; phone?: string | null; clientId?: string | undefined; createdBy: Types.ObjectId },
  session: ClientSession,
): Promise<HouseholdDoc> {
  const seq = await nextSequence(`${String(params.organisationId)}:household`, session);
  const [doc] = await HouseholdModel.create(
    [
      {
        organisationId: params.organisationId,
        communityId: params.communityId,
        householdCode: formatCode('HH', seq),
        headName: params.headName ?? null,
        landmark: params.landmark ?? null,
        phone: params.phone ?? null,
        ...(params.clientId ? { clientId: params.clientId } : {}),
        createdBy: params.createdBy,
      },
    ],
    { session },
  );
  return doc!.toObject();
}

export class HouseholdService {
  constructor(private readonly deps: { repo: HouseholdRepository; audit: AuditService }) {}

  list(auth: AuthContext, query: ListHouseholdsQuery) {
    return this.deps.repo.list(auth.scope, query);
  }

  async get(auth: AuthContext, id: string): Promise<HouseholdWithMembers> {
    const h = Types.ObjectId.isValid(id) ? await this.deps.repo.findInScope(auth.scope, id) : null;
    if (!h) throw AppError.notFound('Household');
    // Members are filtered by the caller's PATIENT scope: a CHW sees only their own patients.
    const members = await PatientModel.find(scopedPatientFilter({ householdId: h._id }, auth.scope))
      .select('patientCode fullName carePathway status')
      .sort({ fullName: 1 })
      .lean<PatientDoc[]>();
    return {
      ...toHouseholdDto(h),
      members: members.map((m) => ({ id: String(m._id), patientCode: m.patientCode, fullName: m.fullName, carePathway: m.carePathway, status: m.status })),
    };
  }

  async create(auth: AuthContext, input: CreateHouseholdInput & { organisationId?: string | null }, ctx: RequestContext): Promise<HouseholdDto> {
    const organisationId = await resolveTargetOrganisation(auth.scope, input.organisationId);
    if (input.clientId) {
      const existing = await HouseholdModel.findOne({ organisationId, clientId: input.clientId }).lean<HouseholdDoc>();
      if (existing) return toHouseholdDto(existing);
    }
    await assertCommunityUsable(auth, organisationId, input.communityId);
    let created: HouseholdDoc | undefined;
    await mongoose.connection.transaction(async (session) => {
      created = await insertHousehold(
        { organisationId, communityId: new Types.ObjectId(input.communityId), headName: input.headName ?? null, landmark: input.landmark ?? null, phone: input.phone ?? null, clientId: input.clientId, createdBy: auth.userId },
        session,
      );
      await this.deps.audit.record({ action: 'household.create', auth, organisationId, entityType: 'household', entityId: created._id, session }, ctx);
    });
    return toHouseholdDto(created!);
  }

  async update(auth: AuthContext, id: string, input: UpdateHouseholdInput, ctx: RequestContext): Promise<HouseholdDto> {
    const current = await this.deps.repo.findInScope(auth.scope, id);
    if (!current) throw AppError.notFound('Household');
    const { version, ...changes } = input;
    const updated = await updateVersioned(HouseholdModel, withinScope({ _id: id }, householdScopeFilter(auth.scope)), version, { $set: changes }, toHouseholdDto);
    await this.deps.audit.record(
      { action: 'household.update', auth, organisationId: updated.organisationId, entityType: 'household', entityId: updated._id, metadata: { fields: changedFields(changes) } },
      ctx,
    );
    return toHouseholdDto(updated);
  }
}
