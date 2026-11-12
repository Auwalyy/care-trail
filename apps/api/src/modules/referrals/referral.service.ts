import { randomInt } from 'node:crypto';
import mongoose, { Types, type QueryFilter } from 'mongoose';
import {
  CROCKFORD_ALPHABET,
  REFERRAL_STATUS_LABELS,
  buildReferralCode,
  checkReferralTransition,
  normaliseReferralCode,
  isValidReferralCode,
  type CreatedReferralResponse,
  type ReferralDto,
  type ReferralEventDto,
  type ReferralStatus,
} from '@caretrail/shared-types';
import type { CreateReferralInput, ListReferralsQuery, ReferralTransitionInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { updateVersioned } from '../../utils/versioned.js';
import { withinScope, type AccessScope } from '../access/access-scope.js';
import type { AuditService } from '../audit/audit.service.js';
import { ChwProfileModel } from '../chws/chw.model.js';
import { FacilityModel } from '../facilities/facility.model.js';
import { autoResolveTask } from '../follow-ups/follow-up.service.js';
import { PatientModel, type PatientDoc } from '../patients/patient.model.js';
import type { PatientRepository } from '../patients/patient.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import { UserModel } from '../users/user.model.js';
import { InstructionTemplateModel, type InstructionTemplateDoc } from './instruction-template.model.js';
import { ReferralEventModel, type ReferralEventDoc } from './referral-event.model.js';
import { ReferralModel, type ReferralDoc } from './referral.model.js';

const todayIso = (now: Date) => now.toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const AWAITING_ARRIVAL: readonly ReferralStatus[] = ['issued', 'expired'];

/**
 * Referrals visible within a scope:
 *  - platform: all · programme admin: own organisation
 *  - facility staff: referrals addressed to their facility
 *  - CHW: referrals they issued, or for patients currently assigned to them
 */
export async function referralScopeFilter(scope: AccessScope): Promise<QueryFilter<ReferralDoc>> {
  switch (scope.kind) {
    case 'platform':
      return {};
    case 'organisation':
      return { organisationId: scope.organisationId };
    case 'facility':
      return { organisationId: scope.organisationId, toFacilityId: scope.facilityId };
    case 'chw': {
      const mine = await PatientModel.find({ organisationId: scope.organisationId, assignedChwId: scope.userId, deletedAt: null }).distinct('_id');
      return { organisationId: scope.organisationId, $or: [{ issuedBy: scope.userId }, { patientId: { $in: mine } }] };
    }
  }
}

function randomReferralCode(): string {
  let body = '';
  for (let i = 0; i < 7; i++) body += CROCKFORD_ALPHABET[randomInt(32)];
  return buildReferralCode(body);
}

async function names(ids: (Types.ObjectId | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const users = await UserModel.find({ _id: { $in: unique } }).select('fullName').lean<{ _id: Types.ObjectId; fullName: string }[]>();
  return new Map(users.map((u) => [String(u._id), u.fullName]));
}

export async function toReferralDtos(docs: ReferralDoc[], now: Date): Promise<ReferralDto[]> {
  const patients = await PatientModel.find({ _id: { $in: docs.map((d) => d.patientId) } })
    .select('patientCode fullName sex dateOfBirth estimatedBirthYear carePathway pathwayDetails')
    .lean<PatientDoc[]>();
  const byId = new Map(patients.map((p) => [String(p._id), p]));
  const who = await names(docs.flatMap((d) => [d.issuedBy, d.arrival?.by, d.service?.by, d.completion?.by, d.cancellation?.by]));
  const ref = (id: Types.ObjectId) => ({ id: String(id), name: who.get(String(id)) ?? null });
  const today = todayIso(now);

  return docs.map((d) => {
    const p = byId.get(String(d.patientId));
    return {
      id: String(d._id),
      referralCode: d.referralCode,
      organisationId: String(d.organisationId),
      // Minimal summary for the receiving facility (decision A29): no phone, household or consent.
      patient: {
        id: String(d.patientId),
        patientCode: p?.patientCode ?? '—',
        fullName: p?.fullName ?? 'Unknown',
        sex: p?.sex ?? 'female',
        dateOfBirth: p?.dateOfBirth ?? null,
        estimatedBirthYear: p?.estimatedBirthYear ?? null,
        carePathway: p?.carePathway ?? 'caregiver',
        expectedDeliveryDate: p?.pathwayDetails?.expectedDeliveryDate ?? null,
        deliveryDate: p?.pathwayDetails?.deliveryDate ?? null,
      },
      origin: {
        type: d.origin.type,
        communityId: d.origin.communityId ? String(d.origin.communityId) : null,
        facilityId: d.origin.facilityId ? String(d.origin.facilityId) : null,
      },
      toFacilityId: String(d.toFacilityId),
      issuedBy: { ...ref(d.issuedBy), role: d.issuedByRole },
      issuedAt: d.issuedAt.toISOString(),
      expectedArrivalBy: d.expectedArrivalBy,
      overdue: AWAITING_ARRIVAL.includes(d.status) && d.expectedArrivalBy < today,
      reason: d.reason,
      instructions: d.instructions.map((i) => ({ templateId: String(i.templateId), title: i.title, body: i.body, bodyHa: i.bodyHa ?? null, templateVersion: i.templateVersion })),
      priority: d.priority ?? null,
      status: d.status,
      arrival: d.arrival ? { at: d.arrival.at.toISOString(), by: ref(d.arrival.by) } : null,
      service: d.service ? { at: d.service.at.toISOString(), by: ref(d.service.by), summary: d.service.summary } : null,
      completion: d.completion ? { at: d.completion.at.toISOString(), by: ref(d.completion.by) } : null,
      followUpNote: d.followUpNote ?? null,
      cancellation: d.cancellation ? { at: d.cancellation.at.toISOString(), by: ref(d.cancellation.by), reason: d.cancellation.reason } : null,
      version: d.version,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  });
}

export async function toEventDtos(events: ReferralEventDoc[]): Promise<ReferralEventDto[]> {
  const who = await names(events.map((e) => e.actorId));
  return events.map((e) => ({
    id: String(e._id),
    kind: e.kind,
    fromStatus: e.fromStatus ?? null,
    toStatus: e.toStatus ?? null,
    priority: e.priority ?? null,
    actor: { id: e.actorId ? String(e.actorId) : '', name: e.actorId ? (who.get(String(e.actorId)) ?? null) : 'System', role: e.actorRole ?? null },
    facilityId: e.facilityId ? String(e.facilityId) : null,
    at: e.at.toISOString(),
    note: e.note ?? null,
    source: e.source,
  }));
}

export class ReferralService {
  constructor(private readonly deps: { audit: AuditService; settings: SettingsService; patients: PatientRepository; now?: () => Date }) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private async findOrThrow(auth: AuthContext, id: string): Promise<ReferralDoc> {
    const doc = Types.ObjectId.isValid(id)
      ? await ReferralModel.findOne(withinScope<ReferralDoc>({ _id: id }, await referralScopeFilter(auth.scope))).lean<ReferralDoc>()
      : null;
    if (!doc) throw AppError.notFound('Referral');
    return doc;
  }

  private async dto(doc: ReferralDoc) {
    return (await toReferralDtos([doc], this.now()))[0]!;
  }

  async list(auth: AuthContext, query: ListReferralsQuery): Promise<{ items: ReferralDto[]; total: number }> {
    const filter: QueryFilter<ReferralDoc> = {};
    if (auth.scope.kind === 'platform' && query.organisationId) filter.organisationId = query.organisationId;
    if (query.status?.length) filter.status = { $in: query.status };
    if (query.open) filter.status = { $nin: ['completed', 'cancelled'] };
    if (query.overdue) Object.assign(filter, { status: { $in: AWAITING_ARRIVAL }, expectedArrivalBy: { $lt: todayIso(this.now()) } });
    if (query.toFacilityId) filter.toFacilityId = query.toFacilityId;
    if (query.patientId) filter.patientId = query.patientId;
    if (query.q) filter.referralCode = new RegExp(`^${query.q.toUpperCase().replace(/[^A-Z0-9-]/g, '')}`);
    const scoped = withinScope<ReferralDoc>(filter, await referralScopeFilter(auth.scope));
    const field = query.sort.replace(/^-/, '');
    const dir = query.sort.startsWith('-') ? -1 : 1;
    const [docs, total] = await Promise.all([
      ReferralModel.find(scoped).sort({ [field]: dir, _id: 1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).lean<ReferralDoc[]>(),
      ReferralModel.countDocuments(scoped),
    ]);
    return { items: await toReferralDtos(docs, this.now()), total };
  }

  async get(auth: AuthContext, id: string): Promise<ReferralDto> {
    return this.dto(await this.findOrThrow(auth, id));
  }

  /** Facility verification by the code on the patient's receipt. The check symbol catches typos first. */
  async getByCode(auth: AuthContext, rawCode: string, ctx: RequestContext): Promise<ReferralDto> {
    if (!isValidReferralCode(rawCode)) {
      throw new AppError('VALIDATION_ERROR', 'This referral code is not valid. Check the receipt and try again.', [{ path: 'code', message: 'Invalid referral code' }]);
    }
    const code = normaliseReferralCode(rawCode)!;
    const doc = await ReferralModel.findOne(withinScope<ReferralDoc>({ referralCode: code }, await referralScopeFilter(auth.scope))).lean<ReferralDoc>();
    if (!doc) throw new AppError('NOT_FOUND', 'No referral with this code was issued to your facility.');
    await this.deps.audit.record({ action: 'referral.verify', auth, organisationId: doc.organisationId, entityType: 'referral', entityId: doc._id }, ctx);
    return this.dto(doc);
  }

  async history(auth: AuthContext, id: string): Promise<ReferralEventDto[]> {
    const doc = await this.findOrThrow(auth, id);
    return toEventDtos(await ReferralEventModel.find({ referralId: doc._id }).sort({ at: 1, _id: 1 }).lean<ReferralEventDoc[]>());
  }

  // ── Issue ─────────────────────────────────────────────────────────────────────
  async create(auth: AuthContext, input: CreateReferralInput, ctx: RequestContext): Promise<CreatedReferralResponse> {
    const patient = await this.deps.patients.findInScope(auth.scope, input.patientId);
    if (!patient) throw AppError.notFound('Patient');
    const organisationId = patient.organisationId;

    if (input.clientId) {
      const existing = await this.existingByClientId(auth, organisationId, input.clientId);
      if (existing) return existing;
    }
    if (patient.status !== 'active') throw new AppError('CONFLICT', 'Only active patients can be referred.');
    if (!patient.consent?.facility_sharing?.granted) {
      throw new AppError('CONFLICT', 'The patient has not agreed to share their details with referral facilities. Record their consent first.');
    }
    if (auth.role === 'chw') {
      const profile = await ChwProfileModel.findOne({ userId: auth.userId }).select('canIssueReferrals').lean();
      if (!profile?.canIssueReferrals) throw AppError.forbidden('You are not authorised to issue referrals. Ask your programme administrator.');
    }
    const facility = await FacilityModel.findOne({ _id: input.toFacilityId, organisationId, status: 'active', deletedAt: null }).select('_id').lean();
    if (!facility) throw new AppError('VALIDATION_ERROR', 'Choose an active facility in this programme', [{ path: 'toFacilityId', message: 'Facility not found or inactive' }]);

    const templates = input.instructionTemplateIds.length
      ? await InstructionTemplateModel.find({ _id: { $in: input.instructionTemplateIds }, organisationId, status: 'approved' }).lean<InstructionTemplateDoc[]>()
      : [];
    if (templates.length !== new Set(input.instructionTemplateIds).size) {
      throw new AppError('VALIDATION_ERROR', 'Only clinically approved instructions can be attached', [{ path: 'instructionTemplateIds', message: 'One or more instructions are not approved' }]);
    }

    const now = this.now();
    const settings = await this.deps.settings.forOrganisation(organisationId);
    const base: Partial<ReferralDoc> = {
      organisationId,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      patientId: patient._id,
      origin: { type: 'community', communityId: patient.communityId, facilityId: null },
      toFacilityId: facility._id,
      issuedBy: auth.userId,
      issuedByRole: auth.role,
      issuedAt: now,
      expectedArrivalBy: addDays(todayIso(now), settings.referralExpectedArrivalDays),
      reason: input.reason,
      instructions: templates.map((t) => ({ templateId: t._id, title: t.title, body: t.body, bodyHa: t.bodyHa ?? null, templateVersion: t.version })),
      status: 'issued',
    };

    for (let attempt = 1; ; attempt++) {
      try {
        let created: ReferralDoc | undefined;
        await mongoose.connection.transaction(async (session) => {
          const [doc] = await ReferralModel.create([{ ...base, referralCode: randomReferralCode() }], { session });
          created = doc!.toObject();
          await ReferralEventModel.create([{ organisationId, referralId: created._id, patientId: patient._id, kind: 'status', fromStatus: null, toStatus: 'issued', actorId: auth.userId, actorRole: auth.role, facilityId: auth.user.facilityId ?? null, at: now, note: null, source: auth.client }], { session });
          await this.deps.audit.record({ action: 'referral.issue', auth, organisationId, entityType: 'referral', entityId: created._id, metadata: { instructions: templates.length }, session }, ctx);
        });
        return { referral: await this.dto(created!), alreadyIssued: false };
      } catch (err) {
        const e = err as { code?: number; keyPattern?: Record<string, unknown> };
        if (e.code === 11000 && e.keyPattern?.referralCode && attempt < 5) continue; // code collision: draw again
        if (e.code === 11000 && e.keyPattern?.clientId && input.clientId) {
          const existing = await this.existingByClientId(auth, organisationId, input.clientId);
          if (existing) return existing;
        }
        throw err;
      }
    }
  }

  private async existingByClientId(auth: AuthContext, organisationId: Types.ObjectId, clientId: string): Promise<CreatedReferralResponse | null> {
    const doc = await ReferralModel.findOne({ organisationId, clientId }).lean<ReferralDoc>();
    if (!doc) return null;
    const visible = await ReferralModel.findOne(withinScope<ReferralDoc>({ _id: doc._id }, await referralScopeFilter(auth.scope))).lean<ReferralDoc>();
    if (!visible) throw AppError.conflict('This referral was already submitted by another user.');
    return { referral: await this.dto(visible), alreadyIssued: true };
  }

  // ── Closed loop ───────────────────────────────────────────────────────────────
  async transition(auth: AuthContext, id: string, input: ReferralTransitionInput, ctx: RequestContext): Promise<ReferralDto> {
    const doc = await this.findOrThrow(auth, id);
    const note = input.note ?? null;
    const check = checkReferralTransition(doc.status, input.toStatus, auth.role, note);
    if (!check.allowed) {
      if (check.reason === 'actor_not_permitted') throw AppError.forbidden(`Your role cannot move a referral to “${REFERRAL_STATUS_LABELS[input.toStatus]}”.`);
      if (check.reason === 'note_required') throw new AppError('VALIDATION_ERROR', 'Give a reason for this change', [{ path: 'note', message: 'Required' }]);
      throw new AppError('INVALID_TRANSITION', `A referral that is “${REFERRAL_STATUS_LABELS[doc.status]}” cannot become “${REFERRAL_STATUS_LABELS[input.toStatus]}”.`, {
        from: doc.status,
        to: input.toStatus,
      });
    }

    const now = this.now();
    const step = { at: now, by: auth.userId };
    const $set: Record<string, unknown> = { status: input.toStatus };
    if (input.toStatus === 'patient_arrived') $set.arrival = step;
    if (input.toStatus === 'service_recorded') $set.service = { ...step, summary: input.serviceSummary };
    if (input.toStatus === 'follow_up_required') $set.followUpNote = note;
    if (input.toStatus === 'completed') $set.completion = step;
    if (input.toStatus === 'cancelled') $set.cancellation = { ...step, reason: note };

    let updated: ReferralDoc | undefined;
    await mongoose.connection.transaction(async (session) => {
      updated = await updateVersioned<ReferralDoc, unknown>(ReferralModel, { _id: doc._id }, input.version, { $set }, (d) => ({ status: d.status, version: d.version }), session);
      await ReferralEventModel.create([{ organisationId: doc.organisationId, referralId: doc._id, patientId: doc.patientId, kind: 'status', fromStatus: doc.status, toStatus: input.toStatus, actorId: auth.userId, actorRole: auth.role, facilityId: auth.user.facilityId ?? null, at: now, note: input.toStatus === 'service_recorded' ? null : note, source: auth.client }], { session });
      // Close the community follow-up that this step makes unnecessary.
      if (input.toStatus === 'patient_arrived') await autoResolveTask({ type: 'referral', id: doc._id }, 'referral_not_arrived', 'Patient arrived at the facility', now, session);
      if (doc.status === 'follow_up_required' && input.toStatus === 'completed') await autoResolveTask({ type: 'referral', id: doc._id }, 'referral_incomplete', 'Referral completed by the facility', now, session);
      if (input.toStatus === 'cancelled') await autoResolveTask({ type: 'referral', id: doc._id }, 'referral_not_arrived', 'Referral cancelled', now, session);
      // Free-text notes and service summaries stay with the referral, never in the audit log.
      await this.deps.audit.record({ action: 'referral.status', auth, organisationId: doc.organisationId, entityType: 'referral', entityId: doc._id, metadata: { from: doc.status, to: input.toStatus }, session }, ctx);
    });
    return this.dto(updated!);
  }

  /** Priority is a clinical judgement made by facility staff (decision A2). */
  async setPriority(auth: AuthContext, id: string, input: { priority: 'routine' | 'urgent'; version: number }, ctx: RequestContext): Promise<ReferralDto> {
    const doc = await this.findOrThrow(auth, id);
    if (doc.status === 'completed' || doc.status === 'cancelled') throw new AppError('CONFLICT', 'This referral is closed.');
    const now = this.now();
    let updated: ReferralDoc | undefined;
    await mongoose.connection.transaction(async (session) => {
      updated = await updateVersioned<ReferralDoc, unknown>(ReferralModel, { _id: doc._id }, input.version, { $set: { priority: input.priority } }, (d) => ({ priority: d.priority, version: d.version }), session);
      await ReferralEventModel.create([{ organisationId: doc.organisationId, referralId: doc._id, patientId: doc.patientId, kind: 'priority', fromStatus: null, toStatus: null, priority: input.priority, actorId: auth.userId, actorRole: auth.role, facilityId: auth.user.facilityId ?? null, at: now, note: null, source: auth.client }], { session });
      await this.deps.audit.record({ action: 'referral.priority', auth, organisationId: doc.organisationId, entityType: 'referral', entityId: doc._id, metadata: { priority: input.priority }, session }, ctx);
    });
    return this.dto(updated!);
  }
}
