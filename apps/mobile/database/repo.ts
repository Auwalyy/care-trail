import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { z } from 'zod';
import {
  LOCAL_REF_PREFIX,
  nameKey,
  type AppointmentDto,
  type CommunityDto,
  type ContactMethod,
  type FacilityDto,
  type FollowUpTaskDto,
  type HouseholdDto,
  type InstructionTemplateDto,
  type PatientDto,
  type ReferralDto,
  type SyncOpType,
  type SyncSettings,
  type VisitDto,
} from '@caretrail/shared-types';
import { contactAttemptSchema, createAppointmentSchema, createReferralSchema, createVisitSchema, registerPatientSchema, resolveFollowUpSchema, updatePatientSchema } from '@caretrail/validation';
import { notifyDataChanged } from '@/store/data-version';
import { rowToEntry } from './sqlite-store';
import { getDb, kvGet } from './db';

const rows = async <T>(sql: string, ...params: (string | number)[]) => (await (await getDb()).getAllAsync<{ json: string }>(sql, ...params)).map((r) => JSON.parse(r.json) as T);
const row = async <T>(sql: string, ...params: (string | number)[]) => {
  const r = await (await getDb()).getFirstAsync<{ json: string }>(sql, ...params);
  return r ? (JSON.parse(r.json) as T) : null;
};
export const isLocal = (id: string) => id.startsWith(LOCAL_REF_PREFIX);
const today = () => new Date().toISOString().slice(0, 10);

export type FieldErrors = Record<string, string>;
export class LocalValidationError extends Error {
  constructor(public readonly fields: FieldErrors) {
    super('Please check the form');
  }
}

function validate<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new LocalValidationError(Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message])));
  return r.data;
}

/** Inserts an outbox op inside an existing transaction. */
async function enqueue(tx: SQLiteDatabase, op: { opType: SyncOpType; entityLocalId: string; payload: unknown; targetId?: string | null; dependsOn?: string | null }) {
  const opId = Crypto.randomUUID();
  await tx.runAsync(
    "INSERT INTO outbox (op_id, op_type, entity_local_id, target_id, payload, depends_on, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
    opId, op.opType, op.entityLocalId, op.targetId ?? null, JSON.stringify(op.payload), op.dependsOn ?? null, new Date().toISOString(),
  );
  return opId;
}

/** The latest unsynced op that touches a record, so a new op on it waits for that one first. */
async function lastOpFor(tx: SQLiteDatabase, refId: string): Promise<string | null> {
  const clientId = isLocal(refId) ? refId.slice(LOCAL_REF_PREFIX.length) : null;
  const r = await tx.getFirstAsync<{ op_id: string }>(
    "SELECT op_id FROM outbox WHERE status != 'synced' AND (target_id = ? OR entity_local_id = ?) ORDER BY created_at DESC LIMIT 1",
    refId, clientId ?? refId,
  );
  return r?.op_id ?? null;
}

// ── Reads ───────────────────────────────────────────────────────────────────────
export async function listPatients(search: string): Promise<PatientDto[]> {
  const q = search.trim();
  if (!q) return rows<PatientDto>('SELECT json FROM patients ORDER BY name COLLATE NOCASE');
  return rows<PatientDto>("SELECT json FROM patients WHERE name_key LIKE ? OR json LIKE ? ORDER BY name COLLATE NOCASE", `%${nameKey(q)}%`, `%"patientCode":"${q.toUpperCase()}%`);
}
export const getPatient = (id: string) => row<PatientDto>('SELECT json FROM patients WHERE id = ?', id);
export const patientReferrals = (id: string) => rows<ReferralDto>('SELECT json FROM referrals WHERE patient_id = ? ORDER BY rowid DESC', id);
export const patientAppointments = (id: string) => rows<AppointmentDto>('SELECT json FROM appointments WHERE patient_id = ? ORDER BY scheduled_for DESC', id);
export const patientVisits = (id: string) => rows<VisitDto>('SELECT json FROM visits WHERE patient_id = ? ORDER BY visit_date DESC', id);
export const listReferrals = () => rows<ReferralDto>('SELECT json FROM referrals ORDER BY pending DESC, rowid DESC');
export const getReferral = (id: string) => row<ReferralDto>('SELECT json FROM referrals WHERE id = ?', id);
export const listTasks = (open: boolean) => rows<FollowUpTaskDto>(open ? "SELECT json FROM follow_ups WHERE status NOT IN ('resolved') ORDER BY due_on" : 'SELECT json FROM follow_ups ORDER BY due_on DESC');
export const getTask = (id: string) => row<FollowUpTaskDto>('SELECT json FROM follow_ups WHERE id = ?', id);
export const listFacilities = async () => (await rows<FacilityDto>('SELECT json FROM facilities')).filter((f) => f.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
export const listCommunities = () => rows<CommunityDto>('SELECT json FROM communities');
export const listHouseholds = (communityId: string) => rows<HouseholdDto>('SELECT json FROM households WHERE community_id = ?', communityId);
export const approvedTemplates = () => rows<InstructionTemplateDto>("SELECT json FROM templates WHERE status = 'approved'");
export const syncSettings = () => kvGet<SyncSettings>('sync.settings');

export async function dashboardCounts() {
  const db = await getDb();
  const n = async (sql: string, ...p: string[]) => (await db.getFirstAsync<{ n: number }>(sql, ...p))?.n ?? 0;
  const t = today();
  return {
    patients: await n("SELECT COUNT(*) AS n FROM patients WHERE status = 'active' OR status IS NULL"),
    newRegistrations: await n('SELECT COUNT(*) AS n FROM patients WHERE pending = 1'),
    openReferrals: await n("SELECT COUNT(*) AS n FROM referrals WHERE status NOT IN ('completed','cancelled')"),
    overdueAppointments: await n("SELECT COUNT(*) AS n FROM appointments WHERE status = 'missed' OR (status = 'scheduled' AND scheduled_for < ?)", t),
    openTasks: await n("SELECT COUNT(*) AS n FROM follow_ups WHERE status != 'resolved'"),
    unsynced: await n("SELECT COUNT(*) AS n FROM outbox WHERE status != 'synced'"),
    needsAttention: await n("SELECT COUNT(*) AS n FROM outbox WHERE status = 'conflict' OR (status = 'failed' AND permanent = 1)"),
  };
}

export async function listOutbox() {
  const db = await getDb();
  return (await db.getAllAsync<Parameters<typeof rowToEntry>[0]>("SELECT * FROM outbox WHERE status != 'synced' ORDER BY created_at")).map(rowToEntry);
}

/** Possible duplicates already on this phone (the server repeats the check for the whole programme). */
export async function localDuplicates(fullName: string, birthYear: number, communityId: string): Promise<PatientDto[]> {
  const all = await rows<PatientDto>('SELECT json FROM patients WHERE name_key = ? AND community_id = ?', nameKey(fullName), communityId);
  return all.filter((p) => Math.abs((p.dateOfBirth ? Number(p.dateOfBirth.slice(0, 4)) : (p.estimatedBirthYear ?? 0)) - birthYear) <= 1);
}

// ── Offline writes (entity + outbox in one transaction) ─────────────────────────
export async function registerPatientOffline(input: Record<string, unknown>, chw: { id: string; name: string }, organisationId: string): Promise<string> {
  const clientId = Crypto.randomUUID();
  const payload = { ...input, clientId };
  const v = validate(registerPatientSchema, payload);
  const localId = `${LOCAL_REF_PREFIX}${clientId}`;
  const now = new Date().toISOString();
  const provisional: PatientDto = {
    id: localId, patientCode: 'Pending', organisationId, communityId: v.communityId, householdId: null, assignedChw: chw, fullName: v.fullName, sex: v.sex,
    dateOfBirth: v.dateOfBirth, estimatedBirthYear: v.dateOfBirth ? null : new Date().getUTCFullYear() - (v.estimatedAge ?? 0),
    phone: v.phone ?? null, alternatePhone: v.alternatePhone ?? null, phoneOwner: v.phoneOwner, carePathway: v.carePathway, pathwayDetails: v.pathwayDetails,
    status: 'active', statusReason: null, preferredLanguage: v.preferredLanguage, preferredChannel: v.preferredChannel,
    consent: Object.fromEntries(Object.entries(v.consent.purposes).map(([k, g]) => [k, { granted: g, recordedAt: now }])) as PatientDto['consent'],
    possibleDuplicateOf: [], createdAt: now, updatedAt: now, version: 0,
  };
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('INSERT INTO patients (id, client_id, name, name_key, community_id, status, json, pending) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', localId, clientId, v.fullName, nameKey(v.fullName), v.communityId, 'active', JSON.stringify(provisional));
    await enqueue(tx, { opType: 'patient.register', entityLocalId: clientId, payload });
    await tx.runAsync('DELETE FROM drafts WHERE key = ?', 'registration');
  });
  notifyDataChanged();
  return localId;
}

export async function recordVisitOffline(patientId: string, input: Record<string, unknown>, chw: { id: string; name: string }, organisationId: string) {
  const clientId = Crypto.randomUUID();
  const payload = { ...input, clientId, patientId };
  // Validate with a placeholder id when the patient itself is not synced yet.
  validate(createVisitSchema, { ...payload, patientId: isLocal(patientId) ? '000000000000000000000000' : patientId });
  const local: VisitDto = { id: `${LOCAL_REF_PREFIX}${clientId}`, organisationId, patientId, chw, visitDate: String(input.visitDate), outcome: input.outcome as VisitDto['outcome'], followUpRequired: Boolean(input.followUpRequired), nextActivityDate: (input.nextActivityDate as string) ?? null, notes: (input.notes as string) ?? null, createdAt: new Date().toISOString(), version: 0 };
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('INSERT INTO visits (id, client_id, patient_id, visit_date, json, pending) VALUES (?, ?, ?, ?, ?, 1)', local.id, clientId, patientId, local.visitDate, JSON.stringify(local));
    await enqueue(tx, { opType: 'visit.create', entityLocalId: clientId, payload, dependsOn: isLocal(patientId) ? await lastOpFor(tx, patientId) : null });
  });
  notifyDataChanged();
}

export async function createReferralOffline(patient: PatientDto, input: { toFacilityId: string; reason: string; instructionTemplateIds: string[] }, chw: { id: string; name: string }) {
  const clientId = Crypto.randomUUID();
  const payload = { ...input, clientId, patientId: patient.id };
  validate(createReferralSchema, { ...payload, patientId: isLocal(patient.id) ? '000000000000000000000000' : patient.id });
  const templates = await approvedTemplates();
  const settings = await syncSettings();
  const expected = new Date(Date.now() + (settings?.referralExpectedArrivalDays ?? 7) * 86_400_000).toISOString().slice(0, 10);
  const now = new Date().toISOString();
  // Provisional: NO referral code is invented offline — the receipt says "pending sync" until the server issues one.
  const local = {
    id: `${LOCAL_REF_PREFIX}${clientId}`, referralCode: null, organisationId: patient.organisationId,
    patient: { id: patient.id, patientCode: patient.patientCode, fullName: patient.fullName, sex: patient.sex, dateOfBirth: patient.dateOfBirth, estimatedBirthYear: patient.estimatedBirthYear, carePathway: patient.carePathway, expectedDeliveryDate: patient.pathwayDetails.expectedDeliveryDate, deliveryDate: patient.pathwayDetails.deliveryDate },
    origin: { type: 'community', communityId: patient.communityId, facilityId: null }, toFacilityId: input.toFacilityId, issuedBy: { ...chw, role: 'chw' }, issuedAt: now,
    expectedArrivalBy: expected, overdue: false, reason: input.reason,
    instructions: templates.filter((t) => input.instructionTemplateIds.includes(t.id)).map((t) => ({ templateId: t.id, title: t.title, body: t.body, bodyHa: t.bodyHa, templateVersion: t.version })),
    priority: null, status: 'issued', arrival: null, service: null, completion: null, followUpNote: null, cancellation: null, version: 0, createdAt: now, updatedAt: now,
  };
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('INSERT INTO referrals (id, client_id, patient_id, status, json, pending) VALUES (?, ?, ?, ?, ?, 1)', local.id, clientId, patient.id, 'issued', JSON.stringify(local));
    await enqueue(tx, { opType: 'referral.create', entityLocalId: clientId, payload, dependsOn: isLocal(patient.id) ? await lastOpFor(tx, patient.id) : null });
  });
  notifyDataChanged();
  return local.id;
}

export async function bookAppointmentOffline(patient: PatientDto, input: { facilityId: string; category: string; scheduledFor: string }, chw: { id: string; name: string }) {
  const clientId = Crypto.randomUUID();
  const payload = { ...input, clientId, patientId: patient.id };
  validate(createAppointmentSchema, { ...payload, patientId: isLocal(patient.id) ? '000000000000000000000000' : patient.id });
  const now = new Date().toISOString();
  const local = { id: `${LOCAL_REF_PREFIX}${clientId}`, organisationId: patient.organisationId, patient: { id: patient.id, patientCode: patient.patientCode, fullName: patient.fullName }, facilityId: input.facilityId, category: input.category, scheduledFor: input.scheduledFor, status: 'scheduled', attendance: null, cancellation: null, reschedules: [], missedDetectedAt: null, createdBy: chw, version: 0, createdAt: now, updatedAt: now };
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('INSERT INTO appointments (id, client_id, patient_id, scheduled_for, status, json, pending) VALUES (?, ?, ?, ?, ?, ?, 1)', local.id, clientId, patient.id, input.scheduledFor, 'scheduled', JSON.stringify(local));
    await enqueue(tx, { opType: 'appointment.create', entityLocalId: clientId, payload, dependsOn: isLocal(patient.id) ? await lastOpFor(tx, patient.id) : null });
  });
  notifyDataChanged();
}

/** Contact attempt on a task; applied optimistically on the phone and queued for the server. */
export async function recordAttemptOffline(task: FollowUpTaskDto, input: { method: ContactMethod; reached: boolean; response: string | null }, chw: { id: string; name: string }) {
  const payload = { ...input, version: task.version };
  validate(contactAttemptSchema, payload);
  const status = input.reached ? 'contacted' : task.status === 'contacted' ? 'contacted' : 'in_progress';
  const updated: FollowUpTaskDto = { ...task, status, version: task.version + 1, attempts: [...task.attempts, { at: new Date().toISOString(), by: chw, ...input }] };
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const dependsOn = await lastOpFor(tx, task.id);
    await tx.runAsync('UPDATE follow_ups SET json = ?, status = ?, pending = 1 WHERE id = ?', JSON.stringify(updated), status, task.id);
    await enqueue(tx, { opType: 'followup.attempt', entityLocalId: task.id, targetId: task.id, payload, dependsOn });
  });
  notifyDataChanged();
}

export async function resolveTaskOffline(task: FollowUpTaskDto, outcome: string) {
  const payload = { outcome, version: task.version };
  validate(resolveFollowUpSchema, payload);
  const updated: FollowUpTaskDto = { ...task, status: 'resolved', outcome, version: task.version + 1, resolvedAt: new Date().toISOString() };
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const dependsOn = await lastOpFor(tx, task.id);
    await tx.runAsync("UPDATE follow_ups SET json = ?, status = 'resolved', pending = 1 WHERE id = ?", JSON.stringify(updated), task.id);
    await enqueue(tx, { opType: 'followup.resolve', entityLocalId: task.id, targetId: task.id, payload, dependsOn });
  });
  notifyDataChanged();
}

/** Contact-detail update (identity changes are done online, where conflicts are reviewed). */
export async function updatePatientContactOffline(patient: PatientDto, input: { phone: string | null; preferredLanguage: 'en' | 'ha' }) {
  const payload = { phone: input.phone ?? '', preferredLanguage: input.preferredLanguage, version: patient.version };
  validate(updatePatientSchema, payload);
  const updated: PatientDto = { ...patient, phone: input.phone, preferredLanguage: input.preferredLanguage, version: patient.version + 1 };
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const dependsOn = await lastOpFor(tx, patient.id);
    await tx.runAsync('UPDATE patients SET json = ?, pending = 1 WHERE id = ?', JSON.stringify(updated), patient.id);
    await enqueue(tx, { opType: 'patient.update', entityLocalId: patient.id, targetId: patient.id, payload, dependsOn });
  });
  notifyDataChanged();
}

// ── Resolving sync problems (sync screen) ───────────────────────────────────────
export async function retryOp(opId: string) {
  await (await getDb()).runAsync("UPDATE outbox SET status = 'pending', permanent = 0, next_attempt_at = NULL, last_error = NULL WHERE op_id = ?", opId);
  notifyDataChanged();
}

/** After reviewing duplicate candidates: this really is a different person. */
export async function registerAnyway(opId: string) {
  const db = await getDb();
  const r = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM outbox WHERE op_id = ?', opId);
  if (!r) return;
  // A new opId: the original id's "conflict" answer is stored on the server and would be replayed.
  await db.withExclusiveTransactionAsync(async (tx) => {
    const old = await tx.getFirstAsync<Parameters<typeof rowToEntry>[0]>('SELECT * FROM outbox WHERE op_id = ?', opId);
    if (!old) return;
    const newId = Crypto.randomUUID();
    await tx.runAsync("INSERT INTO outbox (op_id, op_type, entity_local_id, target_id, payload, depends_on, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')", newId, old.op_type, old.entity_local_id, old.target_id, JSON.stringify({ ...JSON.parse(r.payload), confirmNotDuplicate: true }), old.depends_on, old.created_at);
    await tx.runAsync('UPDATE outbox SET depends_on = ? WHERE depends_on = ?', newId, opId);
    await tx.runAsync('DELETE FROM outbox WHERE op_id = ?', opId);
  });
  notifyDataChanged();
}

/** Version conflict: apply my change again on top of the server's latest version. */
export async function reapplyOnLatest(opId: string) {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const old = await tx.getFirstAsync<Parameters<typeof rowToEntry>[0]>('SELECT * FROM outbox WHERE op_id = ?', opId);
    if (!old?.conflict) return;
    const current = (JSON.parse(old.conflict) as { current?: { version?: number } }).current;
    if (typeof current?.version !== 'number') return;
    const newId = Crypto.randomUUID();
    await tx.runAsync("INSERT INTO outbox (op_id, op_type, entity_local_id, target_id, payload, depends_on, created_at, status) VALUES (?, ?, ?, ?, ?, NULL, ?, 'pending')", newId, old.op_type, old.entity_local_id, old.target_id, JSON.stringify({ ...JSON.parse(old.payload), version: current.version }), new Date().toISOString());
    await tx.runAsync('DELETE FROM outbox WHERE op_id = ?', opId);
  });
  notifyDataChanged();
}

/** Drop my change. Provisional records it created are removed; the server version wins. */
export async function discardOp(opId: string) {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const op = await tx.getFirstAsync<Parameters<typeof rowToEntry>[0]>('SELECT * FROM outbox WHERE op_id = ?', opId);
    if (!op) return;
    const table = ({ 'patient.register': 'patients', 'visit.create': 'visits', 'referral.create': 'referrals', 'appointment.create': 'appointments', 'followup.create': 'follow_ups' } as Record<string, string>)[op.op_type];
    if (table) await tx.runAsync(`DELETE FROM ${table} WHERE id = ?`, `${LOCAL_REF_PREFIX}${op.entity_local_id}`);
    // Everything that depends on this op (directly or through a chain) can never succeed: drop it too.
    const toDelete = [opId];
    for (let i = 0; i < toDelete.length; i++) {
      const children = await tx.getAllAsync<{ op_id: string }>('SELECT op_id FROM outbox WHERE depends_on = ?', toDelete[i]!);
      toDelete.push(...children.map((c) => c.op_id));
    }
    for (const id of toDelete) await tx.runAsync('DELETE FROM outbox WHERE op_id = ?', id);
    // Force a full re-pull so locally edited records return to the server's version.
    await tx.runAsync("DELETE FROM kv WHERE key = 'sync.cursor'");
  });
  notifyDataChanged();
}

export async function saveDraft(key: string, value: unknown) {
  await (await getDb()).runAsync('INSERT INTO drafts (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at', key, JSON.stringify(value), new Date().toISOString());
}
export const loadDraft = <T>(key: string) => row<T>('SELECT json FROM drafts WHERE key = ?', key);
export async function clearDraft(key: string) {
  await (await getDb()).runAsync('DELETE FROM drafts WHERE key = ?', key);
}
