import type { ClientSession, QueryFilter, Types, UpdateQuery } from 'mongoose';
import type { ListUsersQuery } from '@caretrail/validation';
import type { AccessScope } from '../access/access-scope.js';
import { UserModel, type UserDoc } from './user.model.js';

/** Users visible within a scope. CHWs only ever see themselves. */
export function userScopeFilter(scope: AccessScope): QueryFilter<UserDoc> {
  switch (scope.kind) {
    case 'platform':
      return {};
    case 'organisation':
      return { organisationId: scope.organisationId };
    case 'facility':
      return { organisationId: scope.organisationId, facilityId: scope.facilityId };
    case 'chw':
      return { _id: scope.userId };
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class UserRepository {
  async list(scope: AccessScope, query: ListUsersQuery): Promise<{ items: UserDoc[]; total: number }> {
    const filter: QueryFilter<UserDoc> = { ...userScopeFilter(scope) };
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;
    // Explicit filters narrow the scope; they can never widen it because the scope keys win.
    if (query.organisationId && scope.kind === 'platform') filter.organisationId = query.organisationId;
    if (query.facilityId && (scope.kind === 'platform' || scope.kind === 'organisation')) filter.facilityId = query.facilityId;
    if (query.q) {
      const re = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ fullName: re }, { email: re }];
    }
    const sortField = query.sort.replace(/^-/, '');
    const sortDir = query.sort.startsWith('-') ? -1 : 1;
    const [items, total] = await Promise.all([
      UserModel.find(filter)
        .sort({ [sortField]: sortDir, _id: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<UserDoc[]>(),
      UserModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  findInScope(scope: AccessScope, id: Types.ObjectId | string): Promise<UserDoc | null> {
    return UserModel.findOne({ _id: id, ...userScopeFilter(scope) }).lean<UserDoc>();
  }

  async create(doc: Partial<UserDoc>, session?: ClientSession): Promise<UserDoc> {
    const [created] = await UserModel.create([doc], session ? { session } : {});
    return created!.toObject();
  }

  /** Optimistic update: returns null when the version no longer matches. */
  updateVersioned(
    id: Types.ObjectId,
    version: number,
    update: UpdateQuery<UserDoc>,
    session?: ClientSession,
  ): Promise<UserDoc | null> {
    return UserModel.findOneAndUpdate(
      { _id: id, version },
      { ...update, $inc: { ...(update.$inc ?? {}), version: 1 } },
      { new: true, session: session ?? null },
    ).lean<UserDoc>();
  }
}
