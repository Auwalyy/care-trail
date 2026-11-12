import mongoose, { Types, type ClientSession, type QueryFilter } from 'mongoose';
import { canTransitionFollowUp, isOpenFollowUp, type FollowUpReason, type FollowUpTaskDto } from '@caretrail/shared-types';
import type { ContactAttemptInput, CreateFollowUpInput, ListFollowUpsQuery } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { updateVersioned } from '../../utils/versioned.js';
import { withinScope, type AccessScope } from '../access/access-scope.js';
import { AppointmentModel } from '../appointments/appointment.model.js';
import type { AuditService } from '../audit/audit.service.js';
import { ChwProfileModel } from '../chws/chw.model.js';
import { PatientModel, type PatientDoc } from '../patients/patient.model.js';
import type { PatientRepository } from '../patients/patient.repository.js';
import { patientSummaries, unknownPatient } from '../patients/patient-summary.js';
import { ReferralModel } from '../referrals/referral.model.js';
import { UserModel } from '../users/user.model.js';
import { FollowUpTaskModel, openKeyFor, type FollowUpTaskDoc } from './follow-up.model.js';

const OPEN_STATUSES = ['pending', 'assigned', 'in_progress', 'contacted'] as const;
const todayIso = (now: Date) => now.toISOString().slice(0, 10);
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

/**
 * Tasks visible within a scope: programme staff see their organisation; CHWs their own tasks;
 * facility staff (and supervisors) only tasks escalated to them.
 */
export function taskScopeFilter(scope: AccessScope, userId: Types.ObjectId): QueryFilter<FollowUpTaskDoc> {
  switch (scope.kind) {
    case 'platform':
      return {};
    case 'organisation':
      return { organisationId: scope.organisationId };
    case 'chw':
      return { organisationId: scope.organisationId, $or: [{ assignedChwId: scope.userId }, { 'escalation.to': userId }] };
    case 'facility':
      return { organisationId: scope.organisationId, 'escalation.to': userId };
  }
}

// ── Helpers shared with appointments and the missed-care check ─────────────────
/** Creates an open task for a source+reason unless one is already open. Returns true if created. */
export async function ensureTask(
  params: { organisationId: Types.ObjectId; patientId: Types.ObjectId; source: { type: 'appointment' | 'referral'; id: Types.ObjectId }; reason: FollowUpReason; dueOn: string; note?: string | null },
  session?: ClientSession,
): Promise<boolean> {
  const patient = await PatientModel.findById(params.patientId).select('assignedChwId status').session(session ?? null).lean<PatientDoc>();
  if (!patient || patient.status !== 'active') return false; // no coordination for inactive records
  const openKey = openKeyFor(params.source.type, params.source.id, params.reason);
  try {
    const res = await FollowUpTaskModel.updateOne(
      { openKey },
      {
        $setOnInsert: {
          organisationId: params.organisationId,
          patientId: params.patientId,
          assignedChwId: patient.assignedChwId,
          source: params.source,
          reason: params.reason,
          status: 'assigned',
          dueOn: params.dueOn,
          note: params.note ?? null,
          attempts: [],
          outcome: null,
          nextAction: null,
          escalation: null,
          openKey,
          createdBy: null,
          resolvedAt: null,
          version: 0,
        },
      },
      { upsert: true, ...(session ? { session } : {}) },
    );
    return res.upsertedCount === 1;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false; // created concurrently
    throw err;
  }
}

/** Resolves the open task for a source+reason (e.g. the patient attended after all). */
export async function autoResolveTask(source: { type: 'appointment' | 'referral'; id: Types.ObjectId }, reason: FollowUpReason, outcome: string, now: Date, session?: ClientSession) {
  await FollowUpTaskModel.updateOne(
    { openKey: openKeyFor(source.type, source.id, reason) },
    { $set: { status: 'resolved', outcome, resolvedAt: now }, $unset: { openKey: 1 }, $inc: { version: 1 } },
    session ? { session } : {},
  );
}

export async function toFollowUpDtos(docs: FollowUpTaskDoc[], now: Date): Promise<FollowUpTaskDto[]> {
  const patients = await patientSummaries(docs.map((d) => d.patientId));
  const userIds = docs.flatMap((d) => [d.assignedChwId, d.createdBy, ...d.attempts.map((a) => a.by), ...(d.escalation ? [d.escalation.by, ...d.escalation.to] : [])]);
  const users = await UserModel.find({ _id: { $in: [...new Set(userIds.filter(Boolean).map(String))] } }).select('fullName').lean<{ _id: Types.ObjectId; fullName: string }[]>();
  const names = new Map(users.map((u) => [String(u._id), u.fullName]));
  const ref = (id: Types.ObjectId) => ({ id: String(id), name: names.get(String(id)) ?? null });
  const referralCodes = new Map(
    (await ReferralModel.find({ _id: { $in: docs.filter((d) => d.source.type === 'referral').map((d) => d.source.id) } }).select('referralCode').lean<{ _id: Types.ObjectId; referralCode: string }[]>()).map((r) => [String(r._id), r.referralCode]),
  );
  const appointmentDates = new Map(
    (await AppointmentModel.find({ _id: { $in: docs.filter((d) => d.source.type === 'appointment').map((d) => d.source.id) } }).select('scheduledFor').lean<{ _id: Types.ObjectId; scheduledFor: string }[]>()).map((a) => [String(a._id), a.scheduledFor]),
  );
  const today = todayIso(now);

  return docs.map((d) => ({
    id: String(d._id),
    organisationId: String(d.organisationId),
    patient: patients.get(String(d.patientId)) ?? unknownPatient(d.patientId),
    assignedChw: ref(d.assignedChwId),
    source: {
      type: d.source.type,
      id: d.source.id ? String(d.source.id) : null,
      label: d.source.type === 'referral' ? (referralCodes.get(String(d.source.id)) ?? null) : d.source.type === 'appointment' ? (appointmentDates.get(String(d.source.id)) ?? null) : null,
    },
    reason: d.reason,
    status: d.status,
    dueOn: d.dueOn,
    overdue: isOpenFollowUp(d.status) && d.dueOn < today,
    note: d.note ?? null,
    attempts: d.attempts.map((a) => ({ at: a.at.toISOString(), by: ref(a.by), method: a.method, reached: a.reached, response: a.response ?? null })),
    outcome: d.outcome ?? null,
    nextAction: d.nextAction ?? null,
    escalation: d.escalation ? { at: d.escalation.at.toISOString(), by: ref(d.escalation.by), to: d.escalation.to.map(ref), notes: d.escalation.notes } : null,
    createdBy: d.createdBy ? ref(d.createdBy) : null,
    resolvedAt: d.resolvedAt ? d.resolvedAt.toISOString() : null,
    version: d.version,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }));
}

export class FollowUpService {
  constructor(private readonly deps: { audit: AuditService; patients: PatientRepository; now?: () => Date }) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private async findOrThrow(auth: AuthContext, id: string): Promise<FollowUpTaskDoc> {
    const doc = Types.ObjectId.isValid(id) ? await FollowUpTaskModel.findOne(withinScope<FollowUpTaskDoc>({ _id: id }, taskScopeFilter(auth.scope, auth.userId))).lean<FollowUpTaskDoc>() : null;
    if (!doc) throw AppError.notFound('Follow-up task');
    return doc;
  }

  private async dto(doc: FollowUpTaskDoc) {
    return (await toFollowUpDtos([doc], this.now()))[0]!;
  }

  async list(auth: AuthContext, q: ListFollowUpsQuery) {
    const filter: QueryFilter<FollowUpTaskDoc> = {};
    if (auth.scope.kind === 'platform' && q.organisationId) filter.organisationId = q.organisationId;
    if (q.status?.length) filter.status = { $in: q.status };
    if (q.open) filter.status = { $in: OPEN_STATUSES };
    if (q.overdue) Object.assign(filter, { status: { $in: OPEN_STATUSES }, dueOn: { $lt: todayIso(this.now()) } });
    if (q.reason) filter.reason = q.reason;
    if (q.assignedChwId) filter.assignedChwId = q.assignedChwId;
    if (q.patientId) filter.patientId = q.patientId;
    const scoped = withinScope<FollowUpTaskDoc>(filter, taskScopeFilter(auth.scope, auth.userId));
    const [docs, total] = await Promise.all([
      FollowUpTaskModel.find(scoped).sort({ dueOn: 1, _id: 1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean<FollowUpTaskDoc[]>(),
      FollowUpTaskModel.countDocuments(scoped),
    ]);
    return { items: await toFollowUpDtos(docs, this.now()), total };
  }

  async get(auth: AuthContext, id: string) {
    return this.dto(await this.findOrThrow(auth, id));
  }

  /** Manual follow-up requested by a CHW or programme staff for a patient in their scope. */
  async create(auth: AuthContext, input: CreateFollowUpInput, ctx: RequestContext): Promise<FollowUpTaskDto> {
    const patient = await this.deps.patients.findInScope(auth.scope, input.patientId);
    if (!patient) throw AppError.notFound('Patient');
    if (patient.status !== 'active') throw new AppError('CONFLICT', 'Follow-ups can only be created for active patients.');
    if (input.clientId) {
      const existing = await FollowUpTaskModel.findOne({ organisationId: patient.organisationId, clientId: input.clientId }).lean<FollowUpTaskDoc>();
      if (existing) return this.dto(existing);
    }
    const doc = (
      await FollowUpTaskModel.create({
        organisationId: patient.organisationId,
        ...(input.clientId ? { clientId: input.clientId } : {}),
        patientId: patient._id,
        assignedChwId: patient.assignedChwId,
        source: { type: 'manual', id: null },
        reason: 'manual',
        status: 'assigned',
        dueOn: input.dueOn,
        note: input.note,
        createdBy: auth.userId,
      })
    ).toObject();
    await this.deps.audit.record({ action: 'followup.create', auth, organisationId: patient.organisationId, entityType: 'follow_up', entityId: doc._id }, ctx);
    return this.dto(doc);
  }

  async update(auth: AuthContext, id: string, input: { status?: 'assigned' | 'in_progress'; dueOn?: string; nextAction?: string | null; version: number }, ctx: RequestContext) {
    const doc = await this.findOrThrow(auth, id);
    if (input.status && !canTransitionFollowUp(doc.status, input.status)) {
      throw new AppError('INVALID_TRANSITION', `A task that is ${doc.status.replace('_', ' ')} cannot become ${input.status.replace('_', ' ')}.`);
    }
    const $set: Partial<FollowUpTaskDoc> = {};
    if (input.status) $set.status = input.status;
    if (input.dueOn) $set.dueOn = input.dueOn;
    if (input.nextAction !== undefined) $set.nextAction = input.nextAction ?? null;
    const updated = await updateVersioned<FollowUpTaskDoc, unknown>(FollowUpTaskModel, { _id: doc._id }, input.version, { $set }, (d) => ({ version: d.version }));
    await this.deps.audit.record({ action: 'followup.update', auth, organisationId: doc.organisationId, entityType: 'follow_up', entityId: doc._id, metadata: { fields: Object.keys($set) } }, ctx);
    return this.dto(updated);
  }

  /** Records a contact attempt. Reaching the patient moves the task to "contacted". */
  async addAttempt(auth: AuthContext, id: string, input: ContactAttemptInput, ctx: RequestContext) {
    const doc = await this.findOrThrow(auth, id);
    if (!isOpenFollowUp(doc.status) && doc.status !== 'escalated') throw new AppError('CONFLICT', 'This task is resolved.');
    const next = input.reached ? 'contacted' : doc.status === 'contacted' ? 'contacted' : 'in_progress';
    const status = canTransitionFollowUp(doc.status, next) ? next : doc.status;
    const updated = await updateVersioned<FollowUpTaskDoc, unknown>(
      FollowUpTaskModel,
      { _id: doc._id },
      input.version,
      { $push: { attempts: { at: this.now(), by: auth.userId, method: input.method, reached: input.reached, response: input.response ?? null } }, $set: { status } },
      (d) => ({ version: d.version }),
    );
    // The patient's response is free text: it stays on the task, never in the audit log.
    await this.deps.audit.record({ action: 'followup.attempt', auth, organisationId: doc.organisationId, entityType: 'follow_up', entityId: doc._id, metadata: { method: input.method, reached: input.reached } }, ctx);
    return this.dto(updated);
  }

  async resolve(auth: AuthContext, id: string, input: { outcome: string; nextAction?: string | null; version: number }, ctx: RequestContext) {
    const doc = await this.findOrThrow(auth, id);
    if (!canTransitionFollowUp(doc.status, 'resolved')) throw new AppError('INVALID_TRANSITION', 'This task is already resolved.');
    const updated = await updateVersioned<FollowUpTaskDoc, unknown>(
      FollowUpTaskModel,
      { _id: doc._id },
      input.version,
      { $set: { status: 'resolved', outcome: input.outcome, nextAction: input.nextAction ?? null, resolvedAt: this.now() }, $unset: { openKey: 1 } },
      (d) => ({ version: d.version }),
    );
    await this.deps.audit.record({ action: 'followup.resolve', auth, organisationId: doc.organisationId, entityType: 'follow_up', entityId: doc._id }, ctx);
    return this.dto(updated);
  }

  /**
   * Escalates to the CHW's supervisor, or to the organisation's programme administrators when no
   * supervisor is set. Escalation records and routes; it makes no clinical decision.
   */
  async escalate(auth: AuthContext, id: string, input: { notes: string; version: number }, ctx: RequestContext) {
    const doc = await this.findOrThrow(auth, id);
    if (!canTransitionFollowUp(doc.status, 'escalated')) throw new AppError('INVALID_TRANSITION', 'This task cannot be escalated in its current state.');
    const profile = await ChwProfileModel.findOne({ userId: doc.assignedChwId }).select('supervisorUserId').lean();
    let to: Types.ObjectId[] = [];
    if (profile?.supervisorUserId) {
      const sup = await UserModel.findOne({ _id: profile.supervisorUserId, status: 'active' }).select('_id').lean();
      if (sup) to = [sup._id];
    }
    if (to.length === 0) {
      to = (await UserModel.find({ organisationId: doc.organisationId, role: 'programme_admin', status: 'active' }).select('_id').lean()).map((u) => u._id);
    }
    if (to.length === 0) throw new AppError('CONFLICT', 'There is nobody to escalate to: set a supervisor for this health worker or add a programme administrator.');

    let updated: FollowUpTaskDoc | undefined;
    await mongoose.connection.transaction(async (session) => {
      updated = await updateVersioned<FollowUpTaskDoc, unknown>(
        FollowUpTaskModel,
        { _id: doc._id },
        input.version,
        { $set: { status: 'escalated', escalation: { at: this.now(), by: auth.userId, to, notes: input.notes } } },
        (d) => ({ version: d.version }),
        session,
      );
      await this.deps.audit.record({ action: 'followup.escalate', auth, organisationId: doc.organisationId, entityType: 'follow_up', entityId: doc._id, metadata: { recipients: to.length }, session }, ctx);
    });
    return this.dto(updated!);
  }

  /** Keeps open tasks with the patient's current CHW after a reassignment. */
  static async followPatientReassignment(patientId: Types.ObjectId, chwId: Types.ObjectId, session?: ClientSession) {
    await FollowUpTaskModel.updateMany({ patientId, openKey: { $type: 'string' } }, { $set: { assignedChwId: chwId }, $inc: { version: 1 } }, session ? { session } : {});
    await FollowUpTaskModel.updateMany({ patientId, reason: 'manual', status: { $in: OPEN_STATUSES } }, { $set: { assignedChwId: chwId }, $inc: { version: 1 } }, session ? { session } : {});
  }
}

export { addDays, todayIso };
