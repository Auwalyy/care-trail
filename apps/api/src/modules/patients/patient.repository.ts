import type { QueryFilter, Types } from 'mongoose';
import type { ConsentSummary, PatientDto } from '@caretrail/shared-types';
import type { ListPatientsQuery } from '@caretrail/validation';
import { escapeRegex } from '../../utils/paging.js';
import { withinScope, type AccessScope } from '../access/access-scope.js';
import { UserModel } from '../users/user.model.js';
import { PatientModel, type ConsentSummaryDoc, type PatientDoc } from './patient.model.js';

/**
 * Patients visible within a scope:
 *  - platform admin: all (every profile read is audited)
 *  - programme admin: own organisation
 *  - CHW: only patients assigned to them
 *  - facility staff: none until referrals/appointments link a patient to their facility (Phase 5+)
 */
export function patientScopeFilter(scope: AccessScope): QueryFilter<PatientDoc> {
  const live = { deletedAt: null };
  switch (scope.kind) {
    case 'platform':
      return live;
    case 'organisation':
      return { ...live, organisationId: scope.organisationId };
    case 'chw':
      return { ...live, organisationId: scope.organisationId, assignedChwId: scope.userId };
    case 'facility':
      return { _id: { $in: [] } };
  }
}

/**
 * A record filter combined with the caller's patient scope. The explicit generic matters: letting
 * TypeScript infer T from Mongoose's conditional filter types yields a different (deep-path) type.
 */
export function scopedPatientFilter(record: QueryFilter<PatientDoc>, scope: AccessScope): QueryFilter<PatientDoc> {
  return withinScope<PatientDoc>(record, patientScopeFilter(scope));
}

function toConsentSummary(c: ConsentSummaryDoc | undefined): ConsentSummary {
  const entry = (e: { granted: boolean; recordedAt: Date } | null | undefined) =>
    e ? { granted: e.granted, recordedAt: e.recordedAt.toISOString() } : null;
  return {
    care_coordination: entry(c?.care_coordination),
    sms: entry(c?.sms),
    voice: entry(c?.voice),
    facility_sharing: entry(c?.facility_sharing),
  };
}

export function toPatientDto(p: PatientDoc, chwName: string | null): PatientDto {
  return {
    id: String(p._id),
    patientCode: p.patientCode,
    organisationId: String(p.organisationId),
    communityId: String(p.communityId),
    householdId: p.householdId ? String(p.householdId) : null,
    assignedChw: { id: String(p.assignedChwId), name: chwName },
    fullName: p.fullName,
    sex: p.sex,
    dateOfBirth: p.dateOfBirth ?? null,
    estimatedBirthYear: p.estimatedBirthYear ?? null,
    phone: p.phone ?? null,
    alternatePhone: p.alternatePhone ?? null,
    phoneOwner: p.phoneOwner,
    carePathway: p.carePathway,
    pathwayDetails: {
      expectedDeliveryDate: p.pathwayDetails?.expectedDeliveryDate ?? null,
      deliveryDate: p.pathwayDetails?.deliveryDate ?? null,
      motherPatientId: p.pathwayDetails?.motherPatientId ? String(p.pathwayDetails.motherPatientId) : null,
    },
    status: p.status,
    statusReason: p.statusReason ?? null,
    preferredLanguage: p.preferredLanguage,
    preferredChannel: p.preferredChannel,
    consent: toConsentSummary(p.consent),
    possibleDuplicateOf: (p.possibleDuplicateOf ?? []).map(String),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    version: p.version,
  };
}

/** Resolves CHW names for a batch of patients (staff names only). */
export async function chwNames(patients: Pick<PatientDoc, 'assignedChwId'>[]): Promise<Map<string, string>> {
  const ids = [...new Set(patients.map((p) => String(p.assignedChwId)))];
  const users = await UserModel.find({ _id: { $in: ids } }).select('fullName').lean<{ _id: Types.ObjectId; fullName: string }[]>();
  return new Map(users.map((u) => [String(u._id), u.fullName]));
}

export async function toPatientDtos(patients: PatientDoc[]): Promise<PatientDto[]> {
  const names = await chwNames(patients);
  return patients.map((p) => toPatientDto(p, names.get(String(p.assignedChwId)) ?? null));
}

export class PatientRepository {
  async list(scope: AccessScope, query: ListPatientsQuery): Promise<{ items: PatientDto[]; total: number }> {
    const filter: QueryFilter<PatientDoc> = {};
    if (scope.kind === 'platform' && query.organisationId) filter.organisationId = query.organisationId;
    if (query.communityId) filter.communityId = query.communityId;
    if (query.assignedChwId) filter.assignedChwId = query.assignedChwId;
    if (query.carePathway) filter.carePathway = query.carePathway;
    if (query.status) filter.status = query.status;
    if (query.possibleDuplicate) filter['possibleDuplicateOf.0'] = { $exists: true };
    if (query.q) {
      const q = query.q.trim();
      const digits = q.replace(/\D/g, '');
      const or: QueryFilter<PatientDoc>[] = [{ fullName: new RegExp(escapeRegex(q), 'i') }, { patientCode: new RegExp(`^${escapeRegex(q.toUpperCase())}`) }];
      if (digits.length >= 6) or.push({ phone: new RegExp(`${digits.replace(/^0/, '')}$`) });
      filter.$or = or;
    }
    const scoped = scopedPatientFilter(filter, scope);
    const field = query.sort.replace(/^-/, '');
    const dir = query.sort.startsWith('-') ? -1 : 1;
    const [docs, total] = await Promise.all([
      PatientModel.find(scoped)
        .sort({ [field]: dir, _id: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<PatientDoc[]>(),
      PatientModel.countDocuments(scoped),
    ]);
    return { items: await toPatientDtos(docs), total };
  }

  findInScope(scope: AccessScope, id: string | Types.ObjectId): Promise<PatientDoc | null> {
    return PatientModel.findOne(scopedPatientFilter({ _id: id }, scope)).lean<PatientDoc>();
  }
}
