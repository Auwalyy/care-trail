import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { ConsentRecordModel } from '../src/modules/consent/consent.model.js';
import { PatientModel } from '../src/modules/patients/patient.model.js';
import type { UserDoc } from '../src/modules/users/user.model.js';
import { buildTestApp, createCommunity, createFacility, createOrganisation, createUser, signIn, useTestDatabase } from './support.js';

useTestDatabase();

const plusDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const CONSENT = {
  purposes: { care_coordination: true, sms: false, voice: false, facility_sharing: true },
  method: 'verbal',
  consentTextVersion: 'KN-2026-v1',
  language: 'ha',
};

async function world() {
  const { app } = buildTestApp();
  const orgA = await createOrganisation('ORGA');
  const orgB = await createOrganisation('ORGB');
  const facA = await createFacility(orgA._id, 'FA');
  const comA = await createCommunity(orgA._id, 'Gwale');
  const comA2 = await createCommunity(orgA._id, 'Nassarawa');
  const comB = await createCommunity(orgB._id, 'Fagge');
  const platform = await createUser('platform_admin');
  const progA = await createUser('programme_admin', { organisationId: orgA._id });
  const progB = await createUser('programme_admin', { organisationId: orgB._id });
  const workerA = await createUser('facility_worker', { organisationId: orgA._id, facilityId: facA._id });
  const chwA = await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id], fullName: 'Hauwa CHW' });
  const chwA2 = await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id] });
  const chwA3 = await createUser('chw', { organisationId: orgA._id, communityIds: [comA2._id] });
  const bearers = new Map<UserDoc, string>();
  const as = async (u: UserDoc) => {
    if (!bearers.has(u)) bearers.set(u, (await signIn(app, u)).bearer);
    return bearers.get(u)!;
  };
  const call = async (u: UserDoc, method: 'get' | 'post' | 'patch' | 'put', path: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set('Authorization', await as(u));
    return body ? r.send(body) : r;
  };
  const register = (u: UserDoc, overrides: Record<string, unknown> = {}) =>
    call(u, 'post', '/patients', {
      fullName: 'Aisha Musa',
      sex: 'female',
      estimatedAge: 24,
      phone: '0803 123 4567',
      communityId: String(comA._id),
      carePathway: 'antenatal',
      pathwayDetails: { expectedDeliveryDate: plusDays(120) },
      consent: CONSENT,
      ...overrides,
    });
  return { app, orgA, orgB, comA, comA2, comB, platform, progA, progB, workerA, chwA, chwA2, chwA3, call, register };
}

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  w = await world();
});

describe('registration', () => {
  it('lets a CHW register a patient with a new household, assigned to themself, with a consent record', async () => {
    const res = await w.register(w.chwA, { household: { mode: 'new', landmark: 'Behind the Juma’at mosque' } });
    expect(res.status).toBe(201);
    const p = res.body.data.patient;
    expect(p).toMatchObject({
      patientCode: 'CT-P-000001',
      assignedChw: { id: String(w.chwA._id), name: 'Hauwa CHW' },
      organisationId: String(w.orgA._id),
      phone: '+2348031234567',
      status: 'active',
      possibleDuplicateOf: [],
      pathwayDetails: { deliveryDate: null, motherPatientId: null },
    });
    expect(p.estimatedBirthYear).toBe(new Date().getUTCFullYear() - 24);
    expect(p.consent.care_coordination.granted).toBe(true);
    expect(p.consent.sms.granted).toBe(false);
    expect(p.householdId).toBeTruthy();
    expect(res.headers['cache-control']).toBe('no-store');

    expect(await ConsentRecordModel.countDocuments({ patientId: p.id })).toBe(1);
    const household = await w.call(w.chwA, 'get', `/households/${p.householdId}`);
    expect(household.body.data).toMatchObject({ householdCode: 'HH-000001', members: [{ id: p.id }] });
  });

  it('is idempotent per clientId, and refuses a clientId already used by someone else', async () => {
    const clientId = randomUUID();
    const first = await w.register(w.chwA, { clientId });
    const retry = await w.register(w.chwA, { clientId });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toMatchObject({ alreadyRegistered: true, patient: { id: first.body.data.patient.id } });
    expect(await PatientModel.countDocuments()).toBe(1);
    expect((await w.register(w.chwA2, { clientId })).status).toBe(409);
  });

  it('keeps CHWs to their own communities and their own caseload', async () => {
    expect((await w.register(w.chwA, { communityId: String(w.comA2._id) })).status).toBe(403);
    expect((await w.register(w.chwA, { assignedChwId: String(w.chwA2._id) })).status).toBe(403);
  });

  it('requires admins to assign a CHW who serves the community', async () => {
    const none = await w.register(w.progA);
    expect(none.status).toBe(400);
    expect(none.body.error.details[0].path).toBe('assignedChwId');
    const wrong = await w.register(w.progA, { assignedChwId: String(w.chwA3._id) });
    expect(wrong.body.error.details[0].message).toMatch(/does not serve/);
    const ok = await w.register(w.progA, { assignedChwId: String(w.chwA2._id) });
    expect(ok.status).toBe(201);
    expect((await w.register(w.progB, { assignedChwId: String(w.chwA._id), communityId: String(w.comB._id) })).status).toBe(400);
  });

  it('enforces consent and pathway rules', async () => {
    const noConsent = await w.register(w.chwA, { consent: { ...CONSENT, purposes: { ...CONSENT.purposes, care_coordination: false } } });
    expect(noConsent.status).toBe(400);
    const male = await w.register(w.chwA, { sex: 'male' });
    expect(male.body.error.details.map((d: { path: string }) => d.path)).toContain('sex');
    expect((await w.register(w.chwA, { carePathway: 'postnatal', pathwayDetails: {} })).status).toBe(400);
  });

  it('warns about likely duplicates with minimal details, and records the override', async () => {
    const first = await w.register(w.chwA);
    const dup = await w.register(w.chwA2, { fullName: 'MUSA  aisha', estimatedAge: undefined, dateOfBirth: `${new Date().getUTCFullYear() - 25}-03-01`, phone: '0809 999 0000' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('POSSIBLE_DUPLICATE');
    const [candidate] = dup.body.error.details.candidates;
    expect(candidate).toEqual({
      id: first.body.data.patient.id,
      patientCode: 'CT-P-000001',
      fullName: 'Aisha Musa',
      birthYear: new Date().getUTCFullYear() - 24,
      communityId: String(w.comA._id),
      assignedChwName: 'Hauwa CHW',
      status: 'active',
    });
    expect(JSON.stringify(dup.body)).not.toContain('+234');

    const confirmed = await w.register(w.chwA2, { fullName: 'Musa Aisha', confirmNotDuplicate: true });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.data.patient.possibleDuplicateOf).toEqual([first.body.data.patient.id]);
    const flagged = await w.call(w.progA, 'get', '/patients?possibleDuplicate=true');
    expect(flagged.body.data.map((p: { id: string }) => p.id)).toEqual([confirmed.body.data.patient.id]);

    // Different community or age → no warning.
    expect((await w.register(w.chwA3, { communityId: String(w.comA2._id) })).status).toBe(201);
    expect((await w.register(w.chwA, { estimatedAge: 40 })).status).toBe(201);
  });
});

describe('data isolation and audited reads', () => {
  it('shows each role only the patients it is entitled to', async () => {
    const res = await w.register(w.chwA);
    const id = res.body.data.patient.id;

    expect((await w.call(w.chwA, 'get', `/patients/${id}`)).status).toBe(200);
    expect((await w.call(w.chwA2, 'get', `/patients/${id}`)).status).toBe(404);
    expect((await w.call(w.chwA2, 'get', '/patients')).body.data).toEqual([]);
    expect((await w.call(w.progA, 'get', `/patients/${id}`)).status).toBe(200);
    expect((await w.call(w.progB, 'get', `/patients/${id}`)).status).toBe(404);
    expect((await w.call(w.progB, 'get', `/patients?organisationId=${String(w.orgA._id)}`)).body.data).toEqual([]);
    expect((await w.call(w.workerA, 'get', `/patients/${id}`)).status).toBe(404);
    expect((await w.call(w.workerA, 'get', '/patients')).body.data).toEqual([]);
    expect((await w.call(w.platform, 'get', `/patients/${id}`)).status).toBe(200);
    expect((await w.call(w.workerA, 'post', '/patients', { fullName: 'x' })).status).toBe(403);
  });

  it('audits every profile read and never puts patient details in the audit log', async () => {
    const res = await w.register(w.chwA, { household: { mode: 'new', headName: 'Malam Sani' } });
    const id = res.body.data.patient.id;
    await w.call(w.progA, 'get', `/patients/${id}`);
    const views = await AuditLogModel.find({ action: 'patient.view', entityId: id }).lean();
    expect(views).toHaveLength(1);
    expect(views[0]!.actorId!.equals(w.progA._id)).toBe(true);

    const all = JSON.stringify(await AuditLogModel.find().lean());
    for (const pii of ['Aisha', 'Musa', '803123', 'Sani', 'KN-2026']) expect(all).not.toContain(pii);
  });

  it('searches by name, code and phone within scope', async () => {
    await w.register(w.chwA);
    await w.register(w.chwA, { fullName: 'Zainab Bello', phone: '0812 555 6666' });
    const names = async (q: string) => (await w.call(w.progA, 'get', `/patients?q=${encodeURIComponent(q)}`)).body.data.map((p: { fullName: string }) => p.fullName);
    expect(await names('zainab')).toEqual(['Zainab Bello']);
    expect(await names('CT-P-000001')).toEqual(['Aisha Musa']);
    expect(await names('08125556666')).toEqual(['Zainab Bello']);
  });
});

describe('updates, status and reassignment', () => {
  it('re-validates the merged record and uses optimistic concurrency', async () => {
    const p = (await w.register(w.chwA)).body.data.patient;
    const path = `/patients/${p.id}`;

    expect((await w.call(w.chwA, 'patch', path, { carePathway: 'postnatal', version: 0 })).status).toBe(400);
    const moved = await w.call(w.chwA, 'patch', path, { carePathway: 'postnatal', pathwayDetails: { deliveryDate: plusDays(-3) }, version: 0 });
    expect(moved.body.data).toMatchObject({ carePathway: 'postnatal', pathwayDetails: { deliveryDate: plusDays(-3), expectedDeliveryDate: null }, version: 1 });

    expect((await w.call(w.chwA, 'patch', path, { preferredChannel: 'sms', version: 1 })).status).toBe(400); // no SMS consent
    expect((await w.call(w.chwA, 'patch', path, { fullName: 'Aisha M. Musa', version: 0 })).status).toBe(409);
    const renamed = await w.call(w.chwA, 'patch', path, { fullName: 'Aisha Muhammad Musa', dateOfBirth: '2001-05-04', version: 1 });
    expect(renamed.body.data).toMatchObject({ fullName: 'Aisha Muhammad Musa', dateOfBirth: '2001-05-04', estimatedBirthYear: null });
    expect((await PatientModel.findById(p.id).lean())!.nameKey).toBe('aisha muhammad musa');

    const wrongCommunity = await w.call(w.progA, 'patch', path, { communityId: String(w.comA2._id), version: 2 });
    expect(wrongCommunity.body.error.details[0].message).toMatch(/Reassign the patient first/);
  });

  it('needs a reason for status changes, and lets only programme staff reassign', async () => {
    const p = (await w.register(w.chwA)).body.data.patient;
    expect((await w.call(w.chwA, 'post', `/patients/${p.id}/status`, { status: 'transferred', version: 0 })).status).toBe(400);
    const moved = await w.call(w.chwA, 'post', `/patients/${p.id}/status`, { status: 'transferred', reason: 'Moved to Kaduna', version: 0 });
    expect(moved.body.data).toMatchObject({ status: 'transferred', statusReason: 'Moved to Kaduna' });

    expect((await w.call(w.chwA, 'post', `/patients/${p.id}/reassign`, { assignedChwId: String(w.chwA2._id), version: 1 })).status).toBe(403);
    expect((await w.call(w.progA, 'post', `/patients/${p.id}/reassign`, { assignedChwId: String(w.chwA3._id), version: 1 })).status).toBe(400);
    const re = await w.call(w.progA, 'post', `/patients/${p.id}/reassign`, { assignedChwId: String(w.chwA2._id), version: 1 });
    expect(re.body.data.assignedChw.id).toBe(String(w.chwA2._id));
    expect((await w.call(w.chwA, 'get', `/patients/${p.id}`)).status).toBe(404);
    expect((await w.call(w.chwA2, 'get', `/patients/${p.id}`)).status).toBe(200);
  });
});

describe('consent', () => {
  it('keeps an append-only history; withdrawing care-coordination consent deactivates the record', async () => {
    const p = (await w.register(w.chwA, { preferredChannel: 'sms', consent: { ...CONSENT, purposes: { ...CONSENT.purposes, sms: true } } })).body.data.patient;
    expect(p.preferredChannel).toBe('sms');

    const smsOff = await w.call(w.chwA, 'post', `/patients/${p.id}/consent`, { ...CONSENT, version: 0 });
    expect(smsOff.status).toBe(201);
    expect(smsOff.body.data).toMatchObject({ preferredChannel: 'none', status: 'active' });

    const withdrawn = await w.call(w.chwA, 'post', `/patients/${p.id}/consent`, { ...CONSENT, purposes: { care_coordination: false, sms: false, voice: false, facility_sharing: false }, method: 'thumbprint', version: 1 });
    expect(withdrawn.body.data).toMatchObject({ status: 'inactive', statusReason: 'Consent to care coordination withdrawn' });
    expect((await w.call(w.chwA, 'post', `/patients/${p.id}/status`, { status: 'active', version: 2 })).status).toBe(409);

    const history = await w.call(w.chwA, 'get', `/patients/${p.id}/consent`);
    expect(history.body.data).toHaveLength(3);
    expect(history.body.data[0]).toMatchObject({ method: 'thumbprint', purposes: { care_coordination: false }, recordedBy: { name: 'Hauwa CHW' } });

    await w.call(w.chwA, 'post', `/patients/${p.id}/consent`, { ...CONSENT, version: 2 });
    expect((await w.call(w.chwA, 'post', `/patients/${p.id}/status`, { status: 'active', version: 3 })).body.data.status).toBe('active');

    const audit = await AuditLogModel.findOne({ action: 'patient.consent_recorded', 'metadata.withdrawn': 'care_coordination' }).lean();
    expect(audit).not.toBeNull();
  });

  it('builds a timeline of registration, consent, status and updates', async () => {
    const p = (await w.register(w.chwA)).body.data.patient;
    await w.call(w.chwA, 'patch', `/patients/${p.id}`, { phone: '0803 000 0000', version: 0 });
    await w.call(w.chwA, 'get', `/patients/${p.id}`); // views are not part of the care timeline
    const t = await w.call(w.chwA, 'get', `/patients/${p.id}/history`);
    expect(t.body.data.map((e: { kind: string }) => e.kind).sort()).toEqual(['consent', 'registered', 'updated']);
    expect(t.body.data.find((e: { kind: string }) => e.kind === 'updated').summary).toBe('Details updated: phone');
  });
});

describe('households and CHW caseloads', () => {
  it('scopes households to a CHW’s communities and members to their own patients', async () => {
    const hA2 = await w.call(w.progA, 'post', '/households', { communityId: String(w.comA2._id), headName: 'Malam Ali' });
    expect(hA2.status).toBe(201);
    expect((await w.call(w.chwA, 'get', `/households/${hA2.body.data.id}`)).status).toBe(404);
    expect((await w.call(w.chwA, 'post', '/households', { communityId: String(w.comA2._id) })).status).toBe(403);
    // Linking a household from another community is refused.
    expect((await w.register(w.chwA, { household: { mode: 'existing', householdId: hA2.body.data.id } })).status).toBe(400);

    const own = await w.call(w.chwA, 'post', '/households', { communityId: String(w.comA._id), landmark: 'Near the borehole' });
    await w.register(w.chwA, { household: { mode: 'existing', householdId: own.body.data.id } });
    await w.register(w.progA, { fullName: 'Zainab Bello', assignedChwId: String(w.chwA2._id), household: { mode: 'existing', householdId: own.body.data.id } });
    const seenByChw = await w.call(w.chwA, 'get', `/households/${own.body.data.id}`);
    expect(seenByChw.body.data.members.map((m: { fullName: string }) => m.fullName)).toEqual(['Aisha Musa']);
    const seenByAdmin = await w.call(w.progA, 'get', `/households/${own.body.data.id}`);
    expect(seenByAdmin.body.data.members).toHaveLength(2);
  });

  it('reports active patient counts per CHW', async () => {
    await w.register(w.chwA);
    await w.register(w.chwA, { fullName: 'Zainab Bello' });
    const list = await w.call(w.progA, 'get', `/chws?communityId=${String(w.comA._id)}`);
    const counts = Object.fromEntries(list.body.data.map((c: { id: string; assignedPatients: number }) => [c.id, c.assignedPatients]));
    expect(counts).toEqual({ [String(w.chwA._id)]: 2, [String(w.chwA2._id)]: 0 });
  });

  it('stores the consent text version in programme settings', async () => {
    const res = await w.call(w.progA, 'put', '/settings', {
      pilot: { communities: null, facilities: null, chws: null, patients: null, durationWeeks: null, startDate: null },
      referralExpectedArrivalDays: 7, appointmentOverdueGraceDays: 1, offlineSessionGraceDays: 14, consentTextVersion: 'KN-2026-v1', version: 0,
    });
    expect(res.body.data.consentTextVersion).toBe('KN-2026-v1');
  });
});
