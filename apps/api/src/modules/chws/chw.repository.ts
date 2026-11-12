import type { QueryFilter, Types } from 'mongoose';
import type { ChwDto } from '@caretrail/shared-types';
import type { ListChwsQuery } from '@caretrail/validation';
import { escapeRegex } from '../../utils/paging.js';
import type { AccessScope } from '../access/access-scope.js';
import { toUserDto } from '../users/user.mapper.js';
import { UserModel, type UserDoc } from '../users/user.model.js';
import { userScopeFilter } from '../users/user.repository.js';
import { PatientModel } from '../patients/patient.model.js';
import { ChwProfileModel, type ChwProfileDoc } from './chw.model.js';
import { withinScope } from '../access/access-scope.js';

export function toChwDto(user: UserDoc, profile: ChwProfileDoc, assignedPatients = 0): ChwDto {
  return {
    id: String(user._id),
    user: toUserDto(user),
    programmeAreas: profile.programmeAreas ?? [],
    canIssueReferrals: profile.canIssueReferrals,
    supervisorUserId: profile.supervisorUserId ? String(profile.supervisorUserId) : null,
    assignedPatients,
    device: {
      lastSyncAt: profile.device?.lastSyncAt ? profile.device.lastSyncAt.toISOString() : null,
      appVersion: profile.device?.appVersion ?? null,
      pendingOperations: profile.device?.pendingOperations ?? null,
    },
    version: profile.version,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export class ChwRepository {
  /** CHW users within scope, joined with their profiles (missing profiles are created). */
  async list(scope: AccessScope, query: ListChwsQuery): Promise<{ items: ChwDto[]; total: number }> {
    const filter: QueryFilter<UserDoc> = { ...userScopeFilter(scope), role: 'chw' };
    if (scope.kind === 'platform' && query.organisationId) filter.organisationId = query.organisationId;
    if (query.status) filter.status = query.status;
    if (query.communityId) filter.communityIds = query.communityId;
    if (query.q) {
      const re = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ fullName: re }, { email: re }];
    }
    const [users, total] = await Promise.all([
      UserModel.find(filter)
        .sort({ fullName: 1, _id: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<UserDoc[]>(),
      UserModel.countDocuments(filter),
    ]);
    const [profiles, counts] = await Promise.all([this.profilesFor(users), activePatientCounts(users.map((u) => u._id))]);
    return { items: users.map((u) => toChwDto(u, profiles.get(String(u._id))!, counts.get(String(u._id)) ?? 0)), total };
  }

  async findInScope(scope: AccessScope, userId: string): Promise<{ user: UserDoc; profile: ChwProfileDoc; assignedPatients: number } | null> {
    const user = await UserModel.findOne(withinScope<UserDoc>({ _id: userId, role: 'chw' }, userScopeFilter(scope))).lean<UserDoc>();
    if (!user) return null;
    const profile = (await this.profilesFor([user])).get(String(user._id))!;
    const assignedPatients = (await activePatientCounts([user._id])).get(String(user._id)) ?? 0;
    return { user, profile, assignedPatients };
  }

  /** Loads profiles, creating default ones for CHW accounts made before profiles existed. */
  private async profilesFor(users: UserDoc[]): Promise<Map<string, ChwProfileDoc>> {
    const ids = users.map((u) => u._id);
    const found = await ChwProfileModel.find({ userId: { $in: ids } }).lean<ChwProfileDoc[]>();
    const map = new Map(found.map((p) => [String(p.userId), p]));
    const missing = users.filter((u) => !map.has(String(u._id)) && u.organisationId);
    for (const u of missing) {
      const p = await ChwProfileModel.findOneAndUpdate(
        { userId: u._id },
        { $setOnInsert: { userId: u._id, organisationId: u.organisationId as Types.ObjectId } },
        { upsert: true, returnDocument: 'after' },
      ).lean<ChwProfileDoc>();
      if (p) map.set(String(u._id), p);
    }
    return map;
  }
}

/** Active patients per CHW (counts only). */
async function activePatientCounts(chwIds: Types.ObjectId[]): Promise<Map<string, number>> {
  const rows = await PatientModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { assignedChwId: { $in: chwIds }, status: 'active', deletedAt: null } },
    { $group: { _id: '$assignedChwId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}
