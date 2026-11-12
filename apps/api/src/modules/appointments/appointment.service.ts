import mongoose, { Types, type QueryFilter } from 'mongoose';
import type { AppointmentDto } from '@caretrail/shared-types';
import type { CreateAppointmentInput, ListAppointmentsQuery } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { updateVersioned } from '../../utils/versioned.js';
import { withinScope, type AccessScope } from '../access/access-scope.js';
import type { AuditService } from '../audit/audit.service.js';
import { FacilityModel } from '../facilities/facility.model.js';
import { addDays, autoResolveTask, ensureTask, todayIso } from '../follow-ups/follow-up.service.js';
import { PatientModel, type PatientDoc } from '../patients/patient.model.js';
import type { PatientRepository } from '../patients/patient.repository.js';
import { isPatientLinkedToFacility, patientSummaries, unknownPatient } from '../patients/patient-summary.js';
import { UserModel } from '../users/user.model.js';
import { AppointmentModel, type AppointmentDoc } from './appointment.model.js';

/** Appointments visible in a scope: facility staff see their facility's; CHWs their patients'. */
export async function appointmentScopeFilter(scope: AccessScope): Promise<QueryFilter<AppointmentDoc>> {
  switch (scope.kind) {
    case 'platform':
      return {};
    case 'organisation':
      return { organisationId: scope.organisationId };
    case 'facility':
      return { organisationId: scope.organisationId, facilityId: scope.facilityId };
    case 'chw': {
      const mine = await PatientModel.find({ organisationId: scope.organisationId, assignedChwId: scope.userId, deletedAt: null }).distinct('_id');
      return { organisationId: scope.organisationId, patientId: { $in: mine } };
    }
  }
}

export async function toAppointmentDtos(docs: AppointmentDoc[]): Promise<AppointmentDto[]> {
  const patients = await patientSummaries(docs.map((d) => d.patientId));
  const ids = docs.flatMap((d) => [d.createdBy, d.attendance?.by, d.cancellation?.by, ...d.reschedules.map((r) => r.by)]);
  const users = await UserModel.find({ _id: { $in: [...new Set(ids.filter(Boolean).map(String))] } }).select('fullName').lean<{ _id: Types.ObjectId; fullName: string }[]>();
  const names = new Map(users.map((u) => [String(u._id), u.fullName]));
  const ref = (id: Types.ObjectId) => ({ id: String(id), name: names.get(String(id)) ?? null });
  return docs.map((d) => ({
    id: String(d._id),
    organisationId: String(d.organisationId),
    patient: patients.get(String(d.patientId)) ?? unknownPatient(d.patientId),
    facilityId: String(d.facilityId),
    category: d.category,
    scheduledFor: d.scheduledFor,
    status: d.status,
    attendance: d.attendance ? { at: d.attendance.at.toISOString(), by: ref(d.attendance.by) } : null,
    cancellation: d.cancellation ? { at: d.cancellation.at.toISOString(), by: ref(d.cancellation.by), reason: d.cancellation.reason } : null,
    reschedules: d.reschedules.map((r) => ({ from: r.from, to: r.to, at: r.at.toISOString(), by: ref(r.by) })),
    missedDetectedAt: d.missedDetectedAt ? d.missedDetectedAt.toISOString() : null,
    createdBy: ref(d.createdBy),
    version: d.version,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }));
}

export class AppointmentService {
  constructor(private readonly deps: { audit: AuditService; patients: PatientRepository; now?: () => Date }) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private async findOrThrow(auth: AuthContext, id: string): Promise<AppointmentDoc> {
    const doc = Types.ObjectId.isValid(id) ? await AppointmentModel.findOne(withinScope<AppointmentDoc>({ _id: id }, await appointmentScopeFilter(auth.scope))).lean<AppointmentDoc>() : null;
    if (!doc) throw AppError.notFound('Appointment');
    return doc;
  }

  private async dto(doc: AppointmentDoc) {
    return (await toAppointmentDtos([doc]))[0]!;
  }

  async list(auth: AuthContext, q: ListAppointmentsQuery) {
    const filter: QueryFilter<AppointmentDoc> = {};
    if (auth.scope.kind === 'platform' && q.organisationId) filter.organisationId = q.organisationId;
    if (q.status?.length) filter.status = { $in: q.status };
    if (q.from || q.to) filter.scheduledFor = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    if (q.facilityId) filter.facilityId = q.facilityId;
    if (q.patientId) filter.patientId = q.patientId;
    if (q.category) filter.category = q.category;
    const scoped = withinScope<AppointmentDoc>(filter, await appointmentScopeFilter(auth.scope));
    const dir = q.sort.startsWith('-') ? -1 : 1;
    const [docs, total] = await Promise.all([
      AppointmentModel.find(scoped).sort({ scheduledFor: dir, _id: 1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean<AppointmentDoc[]>(),
      AppointmentModel.countDocuments(scoped),
    ]);
    return { items: await toAppointmentDtos(docs), total };
  }

  async get(auth: AuthContext, id: string) {
    return this.dto(await this.findOrThrow(auth, id));
  }

  /** Patients a caller may book for: own scope, or (facility staff) patients linked to their facility. */
  private async bookablePatient(auth: AuthContext, patientId: string): Promise<PatientDoc | null> {
    if (auth.scope.kind === 'facility') {
      const p = await PatientModel.findOne({ _id: patientId, organisationId: auth.scope.organisationId, deletedAt: null }).lean<PatientDoc>();
      return p && (await isPatientLinkedToFacility(p._id, auth.scope.facilityId)) ? p : null;
    }
    return this.deps.patients.findInScope(auth.scope, patientId);
  }

  async create(auth: AuthContext, input: CreateAppointmentInput, ctx: RequestContext): Promise<AppointmentDto> {
    const patient = Types.ObjectId.isValid(input.patientId) ? await this.bookablePatient(auth, input.patientId) : null;
    if (!patient) throw AppError.notFound('Patient');
    if (patient.status !== 'active') throw new AppError('CONFLICT', 'Appointments can only be booked for active patients.');
    if (input.clientId) {
      const existing = await AppointmentModel.findOne({ organisationId: patient.organisationId, clientId: input.clientId }).lean<AppointmentDoc>();
      if (existing) return this.dto(existing);
    }
    let facilityId: Types.ObjectId;
    if (auth.scope.kind === 'facility') {
      if (input.facilityId && input.facilityId !== String(auth.scope.facilityId)) throw AppError.forbidden('You can only book appointments at your own facility.');
      facilityId = auth.scope.facilityId;
    } else {
      if (!input.facilityId) throw new AppError('VALIDATION_ERROR', 'Choose a facility', [{ path: 'facilityId', message: 'Choose a facility' }]);
      const f = await FacilityModel.findOne({ _id: input.facilityId, organisationId: patient.organisationId, status: 'active', deletedAt: null }).select('_id').lean();
      if (!f) throw new AppError('VALIDATION_ERROR', 'Facility not found or inactive', [{ path: 'facilityId', message: 'Choose an active facility' }]);
      facilityId = f._id;
    }
    const doc = (
      await AppointmentModel.create({
        organisationId: patient.organisationId,
        ...(input.clientId ? { clientId: input.clientId } : {}),
        patientId: patient._id,
        facilityId,
        category: input.category,
        scheduledFor: input.scheduledFor,
        createdBy: auth.userId,
      })
    ).toObject();
    await this.deps.audit.record({ action: 'appointment.create', auth, organisationId: patient.organisationId, entityType: 'appointment', entityId: doc._id, metadata: { category: input.category } }, ctx);
    return this.dto(doc);
  }

  async reschedule(auth: AuthContext, id: string, input: { scheduledFor: string; version: number }, ctx: RequestContext) {
    const doc = await this.findOrThrow(auth, id);
    if (doc.status !== 'scheduled' && doc.status !== 'missed') throw new AppError('CONFLICT', 'Only scheduled or missed appointments can be rescheduled.');
    const now = this.now();
    let updated: AppointmentDoc | undefined;
    await mongoose.connection.transaction(async (session) => {
      updated = await updateVersioned<AppointmentDoc, unknown>(
        AppointmentModel,
        { _id: doc._id },
        input.version,
        { $set: { scheduledFor: input.scheduledFor, status: 'scheduled', missedDetectedAt: null }, $push: { reschedules: { from: doc.scheduledFor, to: input.scheduledFor, at: now, by: auth.userId } } },
        (d) => ({ version: d.version }),
        session,
      );
      if (doc.status === 'missed') await autoResolveTask({ type: 'appointment', id: doc._id }, 'missed_appointment', `Rescheduled to ${input.scheduledFor}`, now, session);
      await this.deps.audit.record({ action: 'appointment.reschedule', auth, organisationId: doc.organisationId, entityType: 'appointment', entityId: doc._id, session }, ctx);
    });
    return this.dto(updated!);
  }

  async cancel(auth: AuthContext, id: string, input: { reason: string; version: number }, ctx: RequestContext) {
    const doc = await this.findOrThrow(auth, id);
    if (doc.status !== 'scheduled' && doc.status !== 'missed') throw new AppError('CONFLICT', 'Only scheduled or missed appointments can be cancelled.');
    const now = this.now();
    let updated: AppointmentDoc | undefined;
    await mongoose.connection.transaction(async (session) => {
      updated = await updateVersioned<AppointmentDoc, unknown>(AppointmentModel, { _id: doc._id }, input.version, { $set: { status: 'cancelled', cancellation: { at: now, by: auth.userId, reason: input.reason } } }, (d) => ({ version: d.version }), session);
      if (doc.status === 'missed') await autoResolveTask({ type: 'appointment', id: doc._id }, 'missed_appointment', 'Appointment cancelled', now, session);
      await this.deps.audit.record({ action: 'appointment.cancel', auth, organisationId: doc.organisationId, entityType: 'appointment', entityId: doc._id, session }, ctx);
    });
    return this.dto(updated!);
  }

  /** Facility staff record whether the patient came. Attending after being marked missed resolves the follow-up. */
  async recordAttendance(auth: AuthContext, id: string, input: { outcome: 'attended' | 'missed'; version: number }, ctx: RequestContext) {
    const doc = await this.findOrThrow(auth, id);
    const now = this.now();
    if (input.outcome === 'attended' && doc.status !== 'scheduled' && doc.status !== 'missed') throw new AppError('CONFLICT', 'This appointment is closed.');
    if (input.outcome === 'missed' && doc.status !== 'scheduled') throw new AppError('CONFLICT', 'Only scheduled appointments can be marked missed.');
    if (input.outcome === 'missed' && doc.scheduledFor > todayIso(now)) throw new AppError('CONFLICT', 'An appointment cannot be marked missed before its date.');

    let updated: AppointmentDoc | undefined;
    await mongoose.connection.transaction(async (session) => {
      const $set = input.outcome === 'attended' ? { status: 'attended', attendance: { at: now, by: auth.userId } } : { status: 'missed', missedDetectedAt: now };
      updated = await updateVersioned<AppointmentDoc, unknown>(AppointmentModel, { _id: doc._id }, input.version, { $set }, (d) => ({ version: d.version }), session);
      if (input.outcome === 'attended') await autoResolveTask({ type: 'appointment', id: doc._id }, 'missed_appointment', 'Patient attended', now, session);
      else await ensureTask({ organisationId: doc.organisationId, patientId: doc.patientId, source: { type: 'appointment', id: doc._id }, reason: 'missed_appointment', dueOn: addDays(todayIso(now), 2) }, session);
      await this.deps.audit.record({ action: `appointment.${input.outcome}`, auth, organisationId: doc.organisationId, entityType: 'appointment', entityId: doc._id, session }, ctx);
    });
    return this.dto(updated!);
  }
}
