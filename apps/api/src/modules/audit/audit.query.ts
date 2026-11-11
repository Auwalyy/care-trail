import type { QueryFilter } from 'mongoose';
import type { AuditLogDto } from '@caretrail/shared-types';
import type { ListAuditLogsQuery } from '@caretrail/validation';
import { escapeRegex } from '../../utils/paging.js';
import { organisationFilter, type AccessScope } from '../access/access-scope.js';
import { UserModel } from '../users/user.model.js';
import { AuditLogModel, type AuditLogDoc } from './audit-log.model.js';

/** Read side of the audit log (the write side is AuditService). */
export class AuditQueryService {
  async list(scope: AccessScope, query: ListAuditLogsQuery): Promise<{ items: AuditLogDto[]; total: number }> {
    const filter: QueryFilter<AuditLogDoc> = { ...organisationFilter(scope, query.organisationId) };
    if (query.action) filter.action = new RegExp(`^${escapeRegex(query.action)}`);
    if (query.outcome) filter.outcome = query.outcome;
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.actorId) filter.actorId = query.actorId;
    if (query.from || query.to) {
      filter.at = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    }

    const [logs, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ at: -1, _id: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<AuditLogDoc[]>(),
      AuditLogModel.countDocuments(filter),
    ]);

    // Staff names only (actors are users, never patients).
    const actorIds = [...new Set(logs.flatMap((l) => (l.actorId ? [String(l.actorId)] : [])))];
    const actors = await UserModel.find({ _id: { $in: actorIds } }).select('fullName').lean<{ _id: unknown; fullName: string }[]>();
    const names = new Map(actors.map((a) => [String(a._id), a.fullName]));

    return {
      total,
      items: logs.map((l) => ({
        id: String(l._id),
        at: l.at.toISOString(),
        action: l.action,
        outcome: l.outcome,
        actor: l.actorId ? { id: String(l.actorId), name: names.get(String(l.actorId)) ?? null, role: l.actorRole ?? null } : null,
        organisationId: l.organisationId ? String(l.organisationId) : null,
        entityType: l.entityType ?? null,
        entityId: l.entityId ? String(l.entityId) : null,
        metadata: l.metadata ?? null,
      })),
    };
  }
}
