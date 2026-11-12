import mongoose, { Types, type QueryFilter } from 'mongoose';
import type { VisitDto } from '@caretrail/shared-types';
import type { CreateVisitInput, ListVisitsQuery } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { withinScope } from '../access/access-scope.js';
import type { AuditService } from '../audit/audit.service.js';
import { FollowUpTaskModel } from '../follow-ups/follow-up.model.js';
import { PatientModel } from '../patients/patient.model.js';
import type { PatientRepository } from '../patients/patient.repository.js';
import { patientScopeFilter } from '../patients/patient.repository.js';
import { UserModel } from '../users/user.model.js';
import { VisitModel, type VisitDoc } from './visit.model.js';

export async function toVisitDtos(docs: VisitDoc[]): Promise<VisitDto[]> {
  const users = await UserModel.find({ _id: { $in: [...new Set(docs.map((d) => String(d.chwId)))] } }).select('fullName').lean<{ _id: Types.ObjectId; fullName: string }[]>();
  const names = new Map(users.map((u) => [String(u._id), u.fullName]));
  return docs.map((d) => ({
    id: String(d._id),
    organisationId: String(d.organisationId),
    patientId: String(d.patientId),
    chw: { id: String(d.chwId), name: names.get(String(d.chwId)) ?? null },
    visitDate: d.visitDate,
    outcome: d.outcome,
    followUpRequired: d.followUpRequired,
    nextActivityDate: d.nextActivityDate ?? null,
    notes: d.notes ?? null,
    createdAt: d.createdAt.toISOString(),
    version: d.version,
  }));
}

export class VisitService {
  constructor(private readonly deps: { audit: AuditService; patients: PatientRepository }) {}

  async list(auth: AuthContext, q: ListVisitsQuery) {
    const patientIds = await PatientModel.find(patientScopeFilter(auth.scope)).distinct('_id');
    const filter: QueryFilter<VisitDoc> = withinScope<VisitDoc>(q.patientId ? { patientId: q.patientId } : {}, { patientId: { $in: patientIds } });
    const [docs, total] = await Promise.all([
      VisitModel.find(filter).sort({ visitDate: -1, _id: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean<VisitDoc[]>(),
      VisitModel.countDocuments(filter),
    ]);
    return { items: await toVisitDtos(docs), total };
  }

  /** Records a visit; "follow-up required" with a date becomes a task for that date. */
  async create(auth: AuthContext, input: CreateVisitInput, ctx: RequestContext): Promise<VisitDto> {
    const patient = await this.deps.patients.findInScope(auth.scope, input.patientId);
    if (!patient) throw AppError.notFound('Patient');
    if (input.clientId) {
      const existing = await VisitModel.findOne({ organisationId: patient.organisationId, clientId: input.clientId }).lean<VisitDoc>();
      if (existing) return (await toVisitDtos([existing]))[0]!;
    }
    let doc: VisitDoc | undefined;
    await mongoose.connection.transaction(async (session) => {
      const [created] = await VisitModel.create(
        [
          {
            organisationId: patient.organisationId,
            ...(input.clientId ? { clientId: input.clientId } : {}),
            patientId: patient._id,
            chwId: auth.userId,
            visitDate: input.visitDate,
            outcome: input.outcome,
            followUpRequired: input.followUpRequired,
            nextActivityDate: input.nextActivityDate ?? null,
            notes: input.notes ?? null,
          },
        ],
        { session },
      );
      doc = created!.toObject();
      if (input.followUpRequired && input.nextActivityDate && patient.status === 'active') {
        await FollowUpTaskModel.create(
          [{ organisationId: patient.organisationId, patientId: patient._id, assignedChwId: patient.assignedChwId, source: { type: 'manual', id: null }, reason: 'manual', status: 'assigned', dueOn: input.nextActivityDate, note: 'Follow-up planned during a community visit', createdBy: auth.userId }],
          { session },
        );
      }
      await this.deps.audit.record({ action: 'visit.create', auth, organisationId: patient.organisationId, entityType: 'visit', entityId: doc._id, metadata: { outcome: input.outcome }, session }, ctx);
    });
    return (await toVisitDtos([doc!]))[0]!;
  }
}

