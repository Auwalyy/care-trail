import mongoose, { Types } from 'mongoose';
import {
  CONSENT_PURPOSES,
  PATIENT_STATUS_LABELS,
  REFERRAL_STATUS_LABELS,
  nameKey,
  type ConsentPurpose,
  type ConsentRecordDto,
  type DuplicateCandidate,
  type PatientDto,
  type PatientStatus,
  type PatientTimelineEntry,
  type RegisterPatientResponse,
} from '@caretrail/shared-types';
import { pathwayIssues, type ConsentInput, type ListPatientsQuery, type RegisterPatientInput, type UpdatePatientInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { formatCode, nextSequence } from '../../utils/counters.js';
import { changedFields, updateVersioned } from '../../utils/versioned.js';
import { resolveTargetOrganisation, withinScope } from '../access/access-scope.js';
import { AuditLogModel, type AuditLogDoc } from '../audit/audit-log.model.js';
import type { AuditService } from '../audit/audit.service.js';
import { ConsentRecordModel, type ConsentRecordDoc } from '../consent/consent.model.js';
import { HouseholdModel } from '../households/household.model.js';
import { householdScopeFilter } from '../households/household.repository.js';
import { assertCommunityUsable, insertHousehold } from '../households/household.service.js';
import { ReferralEventModel, type ReferralEventDoc } from '../referrals/referral-event.model.js';
import { ReferralModel } from '../referrals/referral.model.js';
import { UserModel, type UserDoc } from '../users/user.model.js';
import { FollowUpService } from '../follow-ups/follow-up.service.js';
import { PatientModel, type ConsentSummaryDoc, type PatientDoc } from './patient.model.js';
import { chwNames, scopedPatientFilter, toPatientDto, toPatientDtos, type PatientRepository } from './patient.repository.js';

const invalid = (path: string, message: string) => new AppError('VALIDATION_ERROR', message, [{ path, message }]);

export class PatientService {
  constructor(private readonly deps: { repo: PatientRepository; audit: AuditService; now?: () => Date }) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  list(auth: AuthContext, query: ListPatientsQuery) {
    return this.deps.repo.list(auth.scope, query);
  }

  private async findOrThrow(auth: AuthContext, id: string): Promise<PatientDoc> {
    const p = Types.ObjectId.isValid(id) ? await this.deps.repo.findInScope(auth.scope, id) : null;
    if (!p) throw AppError.notFound('Patient');
    return p;
  }

  private async dto(p: PatientDoc): Promise<PatientDto> {
    return (await toPatientDtos([p]))[0]!;
  }

  /** Profile read — audited (who looked at whose record, and when). */
  async get(auth: AuthContext, id: string, ctx: RequestContext): Promise<PatientDto> {
    const p = await this.findOrThrow(auth, id);
    await this.deps.audit.record({ action: 'patient.view', auth, organisationId: p.organisationId, entityType: 'patient', entityId: p._id }, ctx);
    return this.dto(p);
  }

  // ── Registration ──────────────────────────────────────────────────────────────
  async register(auth: AuthContext, input: RegisterPatientInput, ctx: RequestContext): Promise<RegisterPatientResponse> {
    const organisationId = await resolveTargetOrganisation(auth.scope, input.organisationId);

    // Safe retry / offline sync: the same clientId always maps to the same patient.
    if (input.clientId) {
      const existing = await this.existingByClientId(auth, organisationId, input.clientId);
      if (existing) return existing;
    }

    await assertCommunityUsable(auth, organisationId, input.communityId);
    const communityId = new Types.ObjectId(input.communityId);
    const assignedChwId = await this.resolveAssignedChw(auth, organisationId, communityId, input.assignedChwId);

    if (input.household.mode === 'existing') {
      await this.assertHouseholdUsable(auth, organisationId, communityId, input.household.householdId, 'household.householdId');
    }
    if (input.pathwayDetails.motherPatientId) await this.assertMother(auth, input.pathwayDetails.motherPatientId);

    const year = this.now().getUTCFullYear();
    const birthYear = input.dateOfBirth ? Number(input.dateOfBirth.slice(0, 4)) : year - (input.estimatedAge as number);
    const key = nameKey(input.fullName);

    const candidates = await this.findDuplicates(organisationId, key, birthYear, communityId);
    if (candidates.length > 0 && !input.confirmNotDuplicate) {
      throw new AppError('POSSIBLE_DUPLICATE', 'Someone with a similar name and age is already registered in this community.', { candidates });
    }

    const now = this.now();
    let created: PatientDoc | undefined;
    try {
      await mongoose.connection.transaction(async (session) => {
        let householdId: Types.ObjectId | null = null;
        if (input.household.mode === 'existing') householdId = new Types.ObjectId(input.household.householdId);
        if (input.household.mode === 'new') {
          const h = await insertHousehold(
            { organisationId, communityId, headName: input.household.headName ?? null, landmark: input.household.landmark ?? null, phone: input.household.phone ?? null, createdBy: auth.userId },
            session,
          );
          householdId = h._id;
        }

        const seq = await nextSequence(`${String(organisationId)}:patient`, session);
        const consent = summaryFrom(input.consent.purposes, now);
        const [doc] = await PatientModel.create(
          [
            {
              organisationId,
              patientCode: formatCode('CT-P', seq),
              ...(input.clientId ? { clientId: input.clientId } : {}),
              communityId,
              householdId,
              assignedChwId,
              fullName: input.fullName,
              nameKey: key,
              sex: input.sex,
              dateOfBirth: input.dateOfBirth,
              estimatedBirthYear: input.dateOfBirth ? null : birthYear,
              birthYear,
              phone: input.phone ?? null,
              alternatePhone: input.alternatePhone ?? null,
              phoneOwner: input.phoneOwner,
              carePathway: input.carePathway,
              pathwayDetails: input.pathwayDetails,
              preferredLanguage: input.preferredLanguage,
              preferredChannel: input.preferredChannel,
              consent,
              possibleDuplicateOf: candidates.map((c) => new Types.ObjectId(c.id)),
              createdBy: auth.userId,
              updatedBy: auth.userId,
            },
          ],
          { session },
        );
        created = doc!.toObject();
        await ConsentRecordModel.create(
          [{ organisationId, patientId: created._id, ...consentFields(input.consent), recordedBy: auth.userId, recordedAt: now }],
          { session },
        );
        await this.deps.audit.record(
          {
            action: 'patient.register',
            auth,
            organisationId,
            entityType: 'patient',
            entityId: created._id,
            metadata: { carePathway: input.carePathway, possibleDuplicates: candidates.length, newHousehold: input.household.mode === 'new' },
            session,
          },
          ctx,
        );
      });
    } catch (err) {
      // A concurrent retry with the same clientId won the race: return its result.
      if ((err as { code?: number }).code === 11000 && input.clientId) {
        const existing = await this.existingByClientId(auth, organisationId, input.clientId);
        if (existing) return existing;
      }
      throw err;
    }
    return { patient: await this.dto(created!), alreadyRegistered: false };
  }

  private async existingByClientId(auth: AuthContext, organisationId: Types.ObjectId, clientId: string): Promise<RegisterPatientResponse | null> {
    const existing = await PatientModel.findOne({ organisationId, clientId }).select('_id').lean();
    if (!existing) return null;
    const visible = await this.deps.repo.findInScope(auth.scope, existing._id);
    if (!visible) throw AppError.conflict('This registration was already submitted by another user.');
    return { patient: await this.dto(visible), alreadyRegistered: true };
  }

  private async findDuplicates(organisationId: Types.ObjectId, key: string, birthYear: number, communityId: Types.ObjectId, excludeId?: Types.ObjectId): Promise<DuplicateCandidate[]> {
    const docs = await PatientModel.find({
      organisationId,
      communityId,
      nameKey: key,
      birthYear: { $gte: birthYear - 1, $lte: birthYear + 1 },
      deletedAt: null,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
      .limit(5)
      .lean<PatientDoc[]>();
    const names = await chwNames(docs);
    return docs.map((d) => ({
      id: String(d._id),
      patientCode: d.patientCode,
      fullName: d.fullName,
      birthYear: d.birthYear,
      communityId: String(d.communityId),
      assignedChwName: names.get(String(d.assignedChwId)) ?? null,
      status: d.status,
    }));
  }

  /** CHWs are always responsible for who they register; admins must pick a CHW who serves the community. */
  private async resolveAssignedChw(auth: AuthContext, organisationId: Types.ObjectId, communityId: Types.ObjectId, requested: string | null | undefined): Promise<Types.ObjectId> {
    if (auth.scope.kind === 'chw') {
      if (requested && requested !== String(auth.userId)) throw AppError.forbidden('Patients you register are assigned to you.');
      return auth.userId;
    }
    if (!requested) throw invalid('assignedChwId', 'Choose the health worker responsible for this person');
    return this.assertChwServes(organisationId, communityId, requested);
  }

  private async assertChwServes(organisationId: Types.ObjectId, communityId: Types.ObjectId, chwId: string | Types.ObjectId): Promise<Types.ObjectId> {
    const chw = await UserModel.findOne({ _id: chwId, organisationId, role: 'chw', status: 'active' }).lean<UserDoc>();
    if (!chw) throw invalid('assignedChwId', 'Choose an active health worker in this organisation');
    if (!chw.communityIds.some((c) => c.equals(communityId))) {
      throw invalid('assignedChwId', 'This health worker does not serve the selected community');
    }
    return chw._id;
  }

  private async assertHouseholdUsable(auth: AuthContext, organisationId: Types.ObjectId, communityId: Types.ObjectId, householdId: string, path: string) {
    const h = await HouseholdModel.findOne(withinScope({ _id: householdId, organisationId, communityId }, householdScopeFilter(auth.scope))).select('_id').lean();
    if (!h) throw invalid(path, 'Household not found in this community');
  }

  private async assertMother(auth: AuthContext, motherId: string) {
    const mother = await this.deps.repo.findInScope(auth.scope, motherId);
    if (!mother || mother.sex !== 'female') throw invalid('pathwayDetails.motherPatientId', "Mother's record not found");
  }

  // ── Updates ───────────────────────────────────────────────────────────────────
  async update(auth: AuthContext, id: string, input: UpdatePatientInput, ctx: RequestContext): Promise<PatientDto> {
    const p = await this.findOrThrow(auth, id);
    const { version, estimatedAge, ...changes } = input;
    const $set: Record<string, unknown> = { updatedBy: auth.userId };
    const year = this.now().getUTCFullYear();

    // Identity: exactly one of date of birth / estimated birth year.
    let dateOfBirth = p.dateOfBirth ?? null;
    let estimatedBirthYear = p.estimatedBirthYear ?? null;
    if (changes.dateOfBirth) {
      dateOfBirth = changes.dateOfBirth;
      estimatedBirthYear = null;
    } else if (estimatedAge !== undefined && estimatedAge !== null) {
      dateOfBirth = null;
      estimatedBirthYear = year - estimatedAge;
    } else if (changes.dateOfBirth === null) {
      throw invalid('dateOfBirth', 'Enter either the date of birth or an estimated age');
    }
    if (dateOfBirth !== (p.dateOfBirth ?? null) || estimatedBirthYear !== (p.estimatedBirthYear ?? null)) {
      Object.assign($set, { dateOfBirth, estimatedBirthYear, birthYear: dateOfBirth ? Number(dateOfBirth.slice(0, 4)) : estimatedBirthYear });
    }
    if (changes.fullName !== undefined) Object.assign($set, { fullName: changes.fullName, nameKey: nameKey(changes.fullName) });
    if (changes.sex !== undefined) $set.sex = changes.sex;

    // Care pathway (re-validated against the merged record).
    const carePathway = changes.carePathway ?? p.carePathway;
    const details = { ...p.pathwayDetails, ...(changes.pathwayDetails ?? {}) };
    const pathwayDetails = {
      expectedDeliveryDate: carePathway === 'antenatal' ? (details.expectedDeliveryDate ?? null) : null,
      deliveryDate: carePathway === 'postnatal' ? (details.deliveryDate ?? null) : null,
      motherPatientId: carePathway === 'newborn' ? (details.motherPatientId ?? null) : null,
    };
    const issues = pathwayIssues({ carePathway, sex: changes.sex ?? p.sex, dateOfBirth, expectedDeliveryDate: pathwayDetails.expectedDeliveryDate, deliveryDate: pathwayDetails.deliveryDate });
    if (issues.length) throw new AppError('VALIDATION_ERROR', 'Request validation failed', issues);
    if (changes.carePathway !== undefined || changes.pathwayDetails !== undefined) {
      if (pathwayDetails.motherPatientId && String(pathwayDetails.motherPatientId) !== String(p.pathwayDetails?.motherPatientId ?? '')) {
        await this.assertMother(auth, String(pathwayDetails.motherPatientId));
      }
      Object.assign($set, { carePathway, pathwayDetails });
    }

    // Location: the assigned CHW must serve the community; the household must be in it.
    const communityId = changes.communityId ? new Types.ObjectId(changes.communityId) : p.communityId;
    if (changes.communityId && !communityId.equals(p.communityId)) {
      await assertCommunityUsable(auth, p.organisationId, communityId);
      await this.assertChwServes(p.organisationId, communityId, p.assignedChwId).catch(() => {
        throw invalid('communityId', 'The assigned health worker does not serve that community. Reassign the patient first.');
      });
      $set.communityId = communityId;
      if (changes.householdId === undefined && p.householdId) $set.householdId = null; // household belongs to the old community
    }
    if (changes.householdId !== undefined) {
      if (changes.householdId) await this.assertHouseholdUsable(auth, p.organisationId, communityId, changes.householdId, 'householdId');
      $set.householdId = changes.householdId ? new Types.ObjectId(changes.householdId) : null;
    }

    // Contact and reminder preferences (must stay consistent with consent).
    const phone = changes.phone !== undefined ? (changes.phone ?? null) : (p.phone ?? null);
    if (changes.phone !== undefined) $set.phone = phone;
    if (changes.alternatePhone !== undefined) $set.alternatePhone = changes.alternatePhone ?? null;
    if (changes.phoneOwner !== undefined || changes.phone !== undefined) $set.phoneOwner = phone ? (changes.phoneOwner ?? p.phoneOwner) : 'none';
    const channel = changes.preferredChannel ?? p.preferredChannel;
    if (channel !== 'none') {
      if (!phone) throw invalid('phone', 'A phone number is needed for reminders');
      if (!p.consent?.[channel]?.granted) throw invalid('preferredChannel', 'The patient has not consented to this kind of reminder');
    }
    if (changes.preferredChannel !== undefined) $set.preferredChannel = changes.preferredChannel;
    if (changes.preferredLanguage !== undefined) $set.preferredLanguage = changes.preferredLanguage;

    const updated = await updateVersioned<PatientDoc, PatientDto>(PatientModel, scopedPatientFilter({ _id: p._id }, auth.scope), version, { $set }, (d) => toPatientDto(d, null));
    await this.deps.audit.record(
      { action: 'patient.update', auth, organisationId: p.organisationId, entityType: 'patient', entityId: p._id, metadata: { fields: changedFields({ ...changes, ...(estimatedAge !== undefined ? { estimatedAge } : {}) }) } },
      ctx,
    );
    return this.dto(updated);
  }

  async setStatus(auth: AuthContext, id: string, input: { status: PatientStatus; reason?: string | null; version: number }, ctx: RequestContext): Promise<PatientDto> {
    const p = await this.findOrThrow(auth, id);
    if (input.status === 'active' && !p.consent?.care_coordination?.granted) {
      throw new AppError('CONFLICT', 'Record the patient’s consent to care coordination before reactivating them.');
    }
    const updated = await updateVersioned<PatientDoc, PatientDto>(
      PatientModel,
      scopedPatientFilter({ _id: p._id }, auth.scope),
      input.version,
      { $set: { status: input.status, statusReason: input.status === 'active' ? null : (input.reason ?? null), updatedBy: auth.userId } },
      (d) => toPatientDto(d, null),
    );
    // The free-text reason may contain personal details: it is kept on the record, not in the audit log.
    await this.deps.audit.record({ action: 'patient.status', auth, organisationId: p.organisationId, entityType: 'patient', entityId: p._id, metadata: { from: p.status, to: input.status } }, ctx);
    return this.dto(updated);
  }

  async reassign(auth: AuthContext, id: string, input: { assignedChwId: string; version: number }, ctx: RequestContext): Promise<PatientDto> {
    const p = await this.findOrThrow(auth, id);
    const chwId = await this.assertChwServes(p.organisationId, p.communityId, input.assignedChwId);
    const updated = await updateVersioned<PatientDoc, PatientDto>(
      PatientModel,
      scopedPatientFilter({ _id: p._id }, auth.scope),
      input.version,
      { $set: { assignedChwId: chwId, updatedBy: auth.userId } },
      (d) => toPatientDto(d, null),
    );
    await FollowUpService.followPatientReassignment(p._id, chwId);
    await this.deps.audit.record({ action: 'patient.reassign', auth, organisationId: p.organisationId, entityType: 'patient', entityId: p._id, metadata: { fields: ['assignedChwId'] } }, ctx);
    return this.dto(updated);
  }

  // ── Consent ───────────────────────────────────────────────────────────────────
  async recordConsent(auth: AuthContext, id: string, input: ConsentInput & { version: number }, ctx: RequestContext): Promise<PatientDto> {
    const p = await this.findOrThrow(auth, id);
    const now = this.now();
    const { version, ...consentInput } = input;
    const granted = CONSENT_PURPOSES.filter((k) => consentInput.purposes[k]);
    const withdrawn = CONSENT_PURPOSES.filter((k) => !consentInput.purposes[k] && p.consent?.[k]?.granted);

    const $set: Record<string, unknown> = { consent: summaryFrom(consentInput.purposes, now), updatedBy: auth.userId };
    if (!consentInput.purposes.care_coordination && p.status === 'active') {
      // Without consent to care coordination, no further coordination happens. The record is kept.
      Object.assign($set, { status: 'inactive', statusReason: 'Consent to care coordination withdrawn' });
    }
    if (p.preferredChannel !== 'none' && !consentInput.purposes[p.preferredChannel]) $set.preferredChannel = 'none';

    let updated: PatientDoc | undefined;
    await mongoose.connection.transaction(async (session) => {
      updated = await updateVersioned<PatientDoc, PatientDto>(PatientModel, scopedPatientFilter({ _id: p._id }, auth.scope), version, { $set }, (d) => toPatientDto(d, null), session);
      await ConsentRecordModel.create([{ organisationId: p.organisationId, patientId: p._id, ...consentFields(consentInput), recordedBy: auth.userId, recordedAt: now }], { session });
      await this.deps.audit.record({ action: 'patient.consent_recorded', auth, organisationId: p.organisationId, entityType: 'patient', entityId: p._id, metadata: { granted, withdrawn }, session }, ctx);
    });
    return this.dto(updated!);
  }

  async consentHistory(auth: AuthContext, id: string): Promise<ConsentRecordDto[]> {
    const p = await this.findOrThrow(auth, id);
    const records = await ConsentRecordModel.find({ patientId: p._id }).sort({ recordedAt: -1 }).lean<ConsentRecordDoc[]>();
    const names = await staffNames(records.map((r) => r.recordedBy));
    return records.map((r) => ({
      id: String(r._id),
      patientId: String(r.patientId),
      purposes: r.purposes,
      method: r.method,
      consentTextVersion: r.consentTextVersion,
      language: r.language,
      witnessName: r.witnessName ?? null,
      recordedBy: { id: String(r.recordedBy), name: names.get(String(r.recordedBy)) ?? null },
      recordedAt: r.recordedAt.toISOString(),
    }));
  }

  /** Care-coordination timeline. Grows with referrals, appointments and follow-ups in later phases. */
  async history(auth: AuthContext, id: string): Promise<PatientTimelineEntry[]> {
    const p = await this.findOrThrow(auth, id);
    const [logs, consents, referralEvents] = await Promise.all([
      AuditLogModel.find({ entityType: 'patient', entityId: p._id, action: { $in: ['patient.register', 'patient.update', 'patient.status', 'patient.reassign'] }, outcome: 'success' })
        .sort({ at: -1 })
        .limit(200)
        .lean<AuditLogDoc[]>(),
      ConsentRecordModel.find({ patientId: p._id }).sort({ recordedAt: -1 }).lean<ConsentRecordDoc[]>(),
      ReferralEventModel.find({ patientId: p._id, kind: 'status' }).sort({ at: -1 }).limit(200).lean<ReferralEventDoc[]>(),
    ]);
    const names = await staffNames([...logs.flatMap((l) => (l.actorId ? [l.actorId] : [])), ...consents.map((c) => c.recordedBy), ...referralEvents.flatMap((e) => (e.actorId ? [e.actorId] : []))]);
    const codes = new Map((await ReferralModel.find({ _id: { $in: referralEvents.map((e) => e.referralId) } }).select('referralCode').lean<{ _id: Types.ObjectId; referralCode: string }[]>()).map((r) => [String(r._id), r.referralCode]));
    const actor = (actorId: Types.ObjectId | null | undefined) => (actorId ? { id: String(actorId), name: names.get(String(actorId)) ?? null } : null);

    const entries: PatientTimelineEntry[] = logs.map((l) => {
      const m = (l.metadata ?? {}) as { fields?: string[]; to?: PatientStatus };
      switch (l.action) {
        case 'patient.register':
          return { at: l.at.toISOString(), kind: 'registered', summary: 'Registered', actor: actor(l.actorId) };
        case 'patient.status':
          return { at: l.at.toISOString(), kind: 'status', summary: `Status changed to ${m.to ? PATIENT_STATUS_LABELS[m.to] : 'unknown'}`, actor: actor(l.actorId) };
        case 'patient.reassign':
          return { at: l.at.toISOString(), kind: 'reassigned', summary: 'Assigned to a different health worker', actor: actor(l.actorId) };
        default:
          return { at: l.at.toISOString(), kind: 'updated', summary: `Details updated${m.fields?.length ? `: ${m.fields.join(', ')}` : ''}`, actor: actor(l.actorId) };
      }
    });
    for (const c of consents) {
      const yes = CONSENT_PURPOSES.filter((k) => c.purposes[k]);
      entries.push({ at: c.recordedAt.toISOString(), kind: 'consent', summary: `Consent recorded (${c.method}): ${yes.length ? yes.join(', ').replace(/_/g, ' ') : 'none granted'}`, actor: actor(c.recordedBy) });
    }
    for (const e of referralEvents) {
      const code = codes.get(String(e.referralId)) ?? '';
      entries.push({ at: e.at.toISOString(), kind: 'referral', referralId: String(e.referralId), summary: `Referral ${code}: ${e.toStatus ? REFERRAL_STATUS_LABELS[e.toStatus] : 'updated'}`, actor: actor(e.actorId) });
    }
    return entries.sort((a, b) => b.at.localeCompare(a.at));
  }
}

function summaryFrom(purposes: Record<ConsentPurpose, boolean>, at: Date): ConsentSummaryDoc {
  return Object.fromEntries(CONSENT_PURPOSES.map((k) => [k, { granted: purposes[k], recordedAt: at }])) as ConsentSummaryDoc;
}

function consentFields(c: ConsentInput) {
  return { purposes: c.purposes, method: c.method, consentTextVersion: c.consentTextVersion, language: c.language, witnessName: c.witnessName ?? null };
}

async function staffNames(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map(String))];
  const users = await UserModel.find({ _id: { $in: unique } }).select('fullName').lean<{ _id: Types.ObjectId; fullName: string }[]>();
  return new Map(users.map((u) => [String(u._id), u.fullName]));
}
