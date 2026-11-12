import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  LOCAL_REF_PREFIX,
  renderNotification,
  type SyncOpResult,
  type SyncOpType,
  type SyncOperation,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from '@caretrail/shared-types';
import {
  contactAttemptSchema,
  createAppointmentSchema,
  createFollowUpSchema,
  createReferralSchema,
  createVisitSchema,
  recordConsentSchema,
  registerPatientSchema,
  resolveFollowUpSchema,
  updatePatientSchema,
} from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { normaliseError } from '../../middleware/error-handler.js';
import type { Logger } from '../../utils/logger.js';
import { withinScope } from '../access/access-scope.js';
import { AppointmentModel, type AppointmentDoc } from '../appointments/appointment.model.js';
import { appointmentScopeFilter, toAppointmentDtos, type AppointmentService } from '../appointments/appointment.service.js';
import type { AuditService } from '../audit/audit.service.js';
import { ChwProfileModel } from '../chws/chw.model.js';
import { CommunityModel, type CommunityDoc } from '../communities/community.model.js';
import { EducationModel, type EducationDoc } from '../education/education.model.js';
import { toEducationDtos } from '../education/education.service.js';
import { NotificationModel, type NotificationDoc } from '../notifications/notification.model.js';
import { toCommunityDto } from '../communities/community.repository.js';
import { FacilityModel, type FacilityDoc } from '../facilities/facility.model.js';
import { toFacilityDto } from '../facilities/facility.repository.js';
import { FollowUpTaskModel, type FollowUpTaskDoc } from '../follow-ups/follow-up.model.js';
import { toFollowUpDtos, type FollowUpService } from '../follow-ups/follow-up.service.js';
import { HouseholdModel, type HouseholdDoc } from '../households/household.model.js';
import { toHouseholdDto } from '../households/household.repository.js';
import { PatientModel, type PatientDoc } from '../patients/patient.model.js';
import { toPatientDtos } from '../patients/patient.repository.js';
import type { PatientService } from '../patients/patient.service.js';
import { InstructionTemplateModel, type InstructionTemplateDoc } from '../referrals/instruction-template.model.js';
import { ReferralModel, type ReferralDoc } from '../referrals/referral.model.js';
import { referralScopeFilter, toReferralDtos, type ReferralService } from '../referrals/referral.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { VisitModel, type VisitDoc } from '../visits/visit.model.js';
import { toVisitDtos, type VisitService } from '../visits/visit.service.js';
import { SyncOperationModel } from './sync-operation.model.js';

/** Re-pull a little before the cursor so writes committed during the previous pull are not missed. */
const CURSOR_OVERLAP_MS = 5_000;
/** A claim older than this is considered abandoned (e.g. the server restarted mid-operation). */
const STALE_CLAIM_MS = 2 * 60_000;

interface Handler {
  schema: z.ZodType;
  /** Which field(s) may hold a `local:<clientId>` reference, and which collection it points into. */
  refs: { field: 'patientId' | 'targetId'; kind: 'patient' | 'task' }[];
  run: (auth: AuthContext, payload: never, targetId: string | null, ctx: RequestContext) => Promise<{ id: string } & object>;
  requireClientId?: boolean;
}

export class SyncService {
  private readonly handlers: Record<SyncOpType, Handler>;

  constructor(
    private readonly deps: {
      patients: PatientService;
      referrals: ReferralService;
      appointments: AppointmentService;
      followUps: FollowUpService;
      visits: VisitService;
      settings: SettingsService;
      audit: AuditService;
      logger: Logger;
    },
  ) {
    const d = deps;
    const target = (t: string | null) => {
      if (!t) throw new AppError('VALIDATION_ERROR', 'targetId is required for this operation');
      return t;
    };
    this.handlers = {
      'patient.register': { schema: registerPatientSchema, refs: [], requireClientId: true, run: async (a, p, _t, c) => (await d.patients.register(a, p, c)).patient },
      'patient.update': { schema: updatePatientSchema, refs: [{ field: 'targetId', kind: 'patient' }], run: (a, p, t, c) => d.patients.update(a, target(t), p, c) },
      'consent.record': { schema: recordConsentSchema, refs: [{ field: 'targetId', kind: 'patient' }], run: (a, p, t, c) => d.patients.recordConsent(a, target(t), p, c) },
      'visit.create': { schema: createVisitSchema, refs: [{ field: 'patientId', kind: 'patient' }], requireClientId: true, run: (a, p, _t, c) => d.visits.create(a, p, c) },
      'referral.create': { schema: createReferralSchema, refs: [{ field: 'patientId', kind: 'patient' }], requireClientId: true, run: async (a, p, _t, c) => (await d.referrals.create(a, p, c)).referral },
      'appointment.create': { schema: createAppointmentSchema, refs: [{ field: 'patientId', kind: 'patient' }], requireClientId: true, run: (a, p, _t, c) => d.appointments.create(a, p, c) },
      'followup.create': { schema: createFollowUpSchema, refs: [{ field: 'patientId', kind: 'patient' }], requireClientId: true, run: (a, p, _t, c) => d.followUps.create(a, p, c) },
      'followup.attempt': { schema: contactAttemptSchema, refs: [{ field: 'targetId', kind: 'task' }], run: (a, p, t, c) => d.followUps.addAttempt(a, target(t), p, c) },
      'followup.resolve': { schema: resolveFollowUpSchema, refs: [{ field: 'targetId', kind: 'task' }], run: (a, p, t, c) => d.followUps.resolve(a, target(t), p, c) },
    };
  }

  // ── Push ──────────────────────────────────────────────────────────────────────
  async push(auth: AuthContext, req: SyncPushRequest, ctx: RequestContext): Promise<SyncPushResponse> {
    const results: SyncOpResult[] = [];
    for (const op of req.operations) {
      results.push(await this.apply(auth, req.deviceId, op, { ...ctx }));
    }
    await this.recordDevice(auth, req.appVersion, req.pendingOperations);
    const applied = results.filter((r) => r.status === 'applied').length;
    await this.deps.audit.record(
      { action: 'sync.push', auth, metadata: { operations: req.operations.length, applied, rejected: results.filter((r) => r.status === 'rejected').length, conflicts: results.filter((r) => r.status === 'conflict').length } },
      ctx,
    );
    return { results, serverTime: new Date().toISOString() };
  }

  private async apply(auth: AuthContext, deviceId: string, op: SyncOperation, ctx: RequestContext): Promise<SyncOpResult> {
    // 1. Idempotency: claim the opId, or return the stored result of an earlier attempt.
    const now = new Date();
    try {
      await SyncOperationModel.create({ opId: op.opId, userId: auth.userId, organisationId: auth.user.organisationId ?? null, deviceId, opType: op.opType, status: 'processing', receivedAt: now });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      const prior = await SyncOperationModel.findOne({ opId: op.opId }).lean();
      if (!prior || !prior.userId.equals(auth.userId)) return { opId: op.opId, status: 'rejected', error: { code: 'CONFLICT', message: 'Operation id already used' } };
      if (prior.status !== 'processing') return { ...(prior.result as object), opId: op.opId, ...(prior.status === 'applied' ? { replayed: true } : {}) } as SyncOpResult;
      if (now.getTime() - prior.receivedAt.getTime() < STALE_CLAIM_MS) return { opId: op.opId, status: 'retry', error: { code: 'IN_PROGRESS', message: 'Still being processed' } };
      // Abandoned claim: the underlying services are idempotent (clientId / version), so re-run.
    }

    const finish = async (result: SyncOpResult) => {
      if (result.status === 'retry') await SyncOperationModel.deleteOne({ opId: op.opId, status: 'processing' });
      else await SyncOperationModel.updateOne({ opId: op.opId }, { $set: { status: result.status, result: { ...result, ...(result.status === 'applied' ? { entity: null } : {}) }, completedAt: new Date() } });
      return result;
    };

    try {
      const handler = this.handlers[op.opType];
      const payload: Record<string, unknown> = { ...op.payload };
      let targetId = op.targetId ?? null;

      // 2. Resolve references to records that were created on the device.
      for (const ref of handler.refs) {
        const raw = ref.field === 'targetId' ? targetId : payload[ref.field];
        if (typeof raw === 'string' && raw.startsWith(LOCAL_REF_PREFIX)) {
          const resolved = await this.resolveLocal(auth, ref.kind, raw.slice(LOCAL_REF_PREFIX.length));
          if (!resolved) return finish({ opId: op.opId, status: 'retry', error: { code: 'DEPENDENCY_PENDING', message: 'A record this depends on has not been synchronised yet' } });
          if (ref.field === 'targetId') targetId = resolved;
          else payload[ref.field] = resolved;
        }
      }
      if (handler.requireClientId && typeof payload.clientId !== 'string') {
        return finish({ opId: op.opId, status: 'rejected', error: { code: 'VALIDATION_ERROR', message: 'clientId is required for offline creation' } });
      }

      // 3. Validate with the same shared schema as the online endpoint, then run the normal service.
      const parsed = handler.schema.safeParse(payload);
      if (!parsed.success) {
        return finish({ opId: op.opId, status: 'rejected', error: { code: 'VALIDATION_ERROR', message: 'Invalid data', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
      }
      const entity = await handler.run(auth, parsed.data as never, targetId, ctx);
      return finish({ opId: op.opId, status: 'applied', serverId: entity.id, entity, replayed: false });
    } catch (err) {
      const e = normaliseError(err);
      if (e.code === 'VERSION_CONFLICT' || e.code === 'POSSIBLE_DUPLICATE') {
        return finish({ opId: op.opId, status: 'conflict', error: { code: e.code, message: e.message }, current: e.details ?? null });
      }
      if (e.status >= 500) {
        this.deps.logger.error({ err, opType: op.opType }, 'Sync operation failed');
        return finish({ opId: op.opId, status: 'retry', error: { code: 'INTERNAL_ERROR', message: 'Temporary server problem' } });
      }
      return finish({ opId: op.opId, status: 'rejected', error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
    }
  }

  private async resolveLocal(auth: AuthContext, kind: 'patient' | 'task', clientId: string): Promise<string | null> {
    const org = auth.user.organisationId;
    if (!org) return null;
    const doc = kind === 'patient' ? await PatientModel.findOne({ organisationId: org, clientId }).select('_id').lean() : await FollowUpTaskModel.findOne({ organisationId: org, clientId }).select('_id').lean();
    return doc ? String(doc._id) : null;
  }

  private async recordDevice(auth: AuthContext, appVersion: string | null, pendingOperations: number | null) {
    if (auth.role !== 'chw') return;
    await ChwProfileModel.updateOne(
      { userId: auth.userId },
      { $set: { 'device.lastSyncAt': new Date(), ...(appVersion ? { 'device.appVersion': appVersion } : {}), ...(pendingOperations !== null ? { 'device.pendingOperations': pendingOperations } : {}) } },
    );
  }

  // ── Pull ──────────────────────────────────────────────────────────────────────
  async pull(auth: AuthContext, since: string | undefined, ctx: RequestContext): Promise<SyncPullResponse> {
    if (auth.scope.kind !== 'chw') throw AppError.forbidden('Synchronisation is for community health workers.');
    const scope = auth.scope;
    const serverTime = new Date();
    const changed = since ? { updatedAt: { $gt: new Date(Date.parse(since) - CURSOR_OVERLAP_MS) } } : {};

    const assignedPatientIds = (await PatientModel.find({ organisationId: scope.organisationId, assignedChwId: scope.userId, deletedAt: null }).distinct('_id')) as Types.ObjectId[];
    const settings = await this.deps.settings.forOrganisation(scope.organisationId);
    const profile = await ChwProfileModel.findOne({ userId: auth.userId }).select('canIssueReferrals').lean();

    const messagesSince = new Date(Math.max(serverTime.getTime() - 30 * 86_400_000, since ? Date.parse(since) - CURSOR_OVERLAP_MS : 0));
    const [patients, households, referrals, appointments, tasks, visits, facilities, communities, templates, education, messages] = await Promise.all([
      PatientModel.find({ _id: { $in: assignedPatientIds }, ...changed }).lean<PatientDoc[]>(),
      HouseholdModel.find({ organisationId: scope.organisationId, communityId: { $in: scope.communityIds }, deletedAt: null, ...changed }).lean<HouseholdDoc[]>(),
      ReferralModel.find(withinScope<ReferralDoc>(changed, await referralScopeFilter(scope))).lean<ReferralDoc[]>(),
      AppointmentModel.find(withinScope<AppointmentDoc>(changed, await appointmentScopeFilter(scope))).lean<AppointmentDoc[]>(),
      FollowUpTaskModel.find({ organisationId: scope.organisationId, assignedChwId: scope.userId, ...changed }).lean<FollowUpTaskDoc[]>(),
      VisitModel.find({ patientId: { $in: assignedPatientIds }, ...changed }).lean<VisitDoc[]>(),
      FacilityModel.find({ organisationId: scope.organisationId, deletedAt: null, ...changed }).lean<FacilityDoc[]>(),
      CommunityModel.find({ _id: { $in: scope.communityIds }, ...changed }).lean<CommunityDoc[]>(),
      InstructionTemplateModel.find({ organisationId: scope.organisationId, status: { $in: ['approved', 'retired'] }, ...changed }).lean<InstructionTemplateDoc[]>(),
      // First sync: published only. Later: anything changed, so unpublished items are removed on the phone.
      EducationModel.find({ organisationId: scope.organisationId, ...(since ? changed : { status: 'published' }) }).lean<EducationDoc[]>(),
      NotificationModel.find({ 'recipient.type': 'user', 'recipient.id': auth.userId, channel: 'in_app', updatedAt: { $gt: messagesSince } }).sort({ createdAt: -1 }).limit(200).lean<NotificationDoc[]>(),
    ]);

    await this.recordDevice(auth, null, null);
    await this.deps.audit.record({ action: 'sync.pull', auth, metadata: { full: !since, patients: patients.length, referrals: referrals.length } }, ctx);

    return {
      cursor: serverTime.toISOString(),
      serverTime: serverTime.toISOString(),
      patients: await toPatientDtos(patients),
      assignedPatientIds: assignedPatientIds.map(String),
      households: households.map(toHouseholdDto),
      referrals: await toReferralDtos(referrals, serverTime),
      appointments: await toAppointmentDtos(appointments),
      followUps: await toFollowUpDtos(tasks, serverTime),
      visits: await toVisitDtos(visits),
      facilities: facilities.map(toFacilityDto),
      communities: communities.map(toCommunityDto),
      templates: templates.map((t) => ({
        id: String(t._id), organisationId: String(t.organisationId), title: t.title, body: t.body, bodyHa: t.bodyHa ?? null, status: t.status, approval: null, version: t.version, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
      })),
      settings: { offlineSessionGraceDays: settings.offlineSessionGraceDays, consentTextVersion: settings.consentTextVersion, referralExpectedArrivalDays: settings.referralExpectedArrivalDays },
      canIssueReferrals: Boolean(profile?.canIssueReferrals),
      education: await toEducationDtos(education),
      messages: messages.map((m) => ({ id: String(m._id), templateKey: m.templateKey, text: renderNotification(m.templateKey, 'en', m.params ?? {}), params: m.params ?? {}, link: m.link ?? null, createdAt: m.createdAt.toISOString(), readAt: m.readAt?.toISOString() ?? null })),
    };
  }

  async status(auth: AuthContext, deviceId: string | undefined) {
    const filter = { userId: auth.userId, ...(deviceId ? { deviceId } : {}) };
    const [applied, rejected, conflicts, last] = await Promise.all([
      SyncOperationModel.countDocuments({ ...filter, status: 'applied' }),
      SyncOperationModel.countDocuments({ ...filter, status: 'rejected' }),
      SyncOperationModel.countDocuments({ ...filter, status: 'conflict' }),
      SyncOperationModel.findOne(filter).sort({ receivedAt: -1 }).select('receivedAt').lean(),
    ]);
    return { serverTime: new Date().toISOString(), lastOperationAt: last?.receivedAt.toISOString() ?? null, applied, rejected, conflicts };
  }
}
