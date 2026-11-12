import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { isValidReferralCode } from '@caretrail/shared-types';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { ChwProfileModel } from '../src/modules/chws/chw.model.js';
import { ReferralEventModel } from '../src/modules/referrals/referral-event.model.js';
import type { UserDoc } from '../src/modules/users/user.model.js';
import { buildTestApp, createCommunity, createFacility, createOrganisation, createUser, signIn, useTestDatabase } from './support.js';

useTestDatabase();

const plusDays = (d: number, from = Date.now()) => new Date(from + d * 86_400_000).toISOString().slice(0, 10);
const consent = (share: boolean) => ({
  purposes: { care_coordination: true, sms: false, voice: false, facility_sharing: share },
  method: 'verbal',
  consentTextVersion: 'KN-2026-v1',
  language: 'ha',
});

async function world() {
  const { app, clock } = buildTestApp();
  const orgA = await createOrganisation('ORGA');
  const orgB = await createOrganisation('ORGB');
  const facA = await createFacility(orgA._id, 'FA');
  const facA2 = await createFacility(orgA._id, 'FA2');
  const facB = await createFacility(orgB._id, 'FB');
  const comA = await createCommunity(orgA._id, 'Gwale');
  const progA = await createUser('programme_admin', { organisationId: orgA._id });
  const progB = await createUser('programme_admin', { organisationId: orgB._id });
  const workerA = await createUser('facility_worker', { organisationId: orgA._id, facilityId: facA._id, fullName: 'Nurse Amina' });
  const workerA2 = await createUser('facility_worker', { organisationId: orgA._id, facilityId: facA2._id });
  const chwA = await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id], fullName: 'Hauwa CHW' });
  const chwNo = await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id] });
  const chwA2 = await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id] });
  await ChwProfileModel.create([
    { userId: chwA._id, organisationId: orgA._id, canIssueReferrals: true },
    { userId: chwNo._id, organisationId: orgA._id, canIssueReferrals: false },
  ]);

  const bearers = new Map<UserDoc, string>();
  const as = async (u: UserDoc) => {
    if (!bearers.has(u)) bearers.set(u, (await signIn(app, u)).bearer);
    return bearers.get(u)!;
  };
  const call = async (u: UserDoc, method: 'get' | 'post' | 'patch', path: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set('Authorization', await as(u));
    return body ? r.send(body) : r;
  };
  const registerAs = async (u: UserDoc, share = true, name = 'Aisha Musa') =>
    (
      await call(u, 'post', '/patients', {
        fullName: name, sex: 'female', estimatedAge: 24, phone: '0803 123 4567', communityId: String(comA._id),
        carePathway: 'antenatal', pathwayDetails: { expectedDeliveryDate: plusDays(100) }, consent: consent(share), confirmNotDuplicate: true,
      })
    ).body.data.patient;
  const patient = await registerAs(chwA);
  const refer = (u: UserDoc, overrides: Record<string, unknown> = {}) =>
    call(u, 'post', '/referrals', { patientId: patient.id, toFacilityId: String(facA._id), reason: 'Antenatal review at facility', ...overrides });
  return { app, clock, orgA, orgB, facA, facA2, facB, comA, progA, progB, workerA, workerA2, chwA, chwNo, chwA2, call, registerAs, patient, refer };
}

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  w = await world();
});

async function approvedTemplate(title = 'Bring your antenatal card') {
  const t = await w.call(w.progA, 'post', '/referral-templates', { title, body: 'Bring the card you were given at your last visit.', bodyHa: 'Ki zo da katin ki.' });
  return (await w.call(w.progA, 'post', `/referral-templates/${t.body.data.id}/approve`, { reviewerName: 'Dr. Z. Ibrahim', reviewerCredentials: 'Obstetrician', approvedOn: plusDays(0), version: 0 })).body.data;
}

describe('instruction templates', () => {
  it('starts as draft, needs a recorded approval, and returns to draft when its wording changes', async () => {
    const created = await w.call(w.progA, 'post', '/referral-templates', { title: 'Fasting', body: 'Do not eat after midnight.' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'draft', approval: null });
    expect((await w.call(w.chwA, 'get', '/referral-templates')).body.data).toEqual([]);

    const approved = await w.call(w.progA, 'post', `/referral-templates/${created.body.data.id}/approve`, { reviewerName: 'Dr. Z. Ibrahim', reviewerCredentials: 'Obstetrician', approvedOn: plusDays(0), version: 0 });
    expect(approved.body.data).toMatchObject({ status: 'approved', approval: { reviewerName: 'Dr. Z. Ibrahim', recordedBy: { id: String(w.progA._id) } } });
    expect((await w.call(w.chwA, 'get', '/referral-templates')).body.data).toHaveLength(1);

    const edited = await w.call(w.progA, 'patch', `/referral-templates/${created.body.data.id}`, { body: 'Do not eat after 10pm.', version: 1 });
    expect(edited.body.data).toMatchObject({ status: 'draft', approval: null });
    expect((await w.call(w.progA, 'post', `/referral-templates/${created.body.data.id}/approve`, { reviewerName: 'X Y', reviewerCredentials: 'RN', approvedOn: plusDays(2), version: 2 })).status).toBe(400);
    const retired = await w.call(w.progA, 'patch', `/referral-templates/${created.body.data.id}`, { status: 'retired', version: 2 });
    expect(retired.body.data.status).toBe('retired');
    expect((await w.call(w.chwA, 'post', '/referral-templates', { title: 'Mine', body: 'Something' })).status).toBe(403);
  });
});

describe('issuing referrals', () => {
  it('issues a referral with a valid code, expected date, instruction snapshot and an event', async () => {
    const t = await approvedTemplate();
    const res = await w.refer(w.chwA, { instructionTemplateIds: [t.id] });
    expect(res.status).toBe(201);
    const r = res.body.data.referral;
    expect(isValidReferralCode(r.referralCode)).toBe(true);
    expect(r).toMatchObject({
      status: 'issued',
      expectedArrivalBy: plusDays(7),
      overdue: false,
      priority: null,
      issuedBy: { id: String(w.chwA._id), name: 'Hauwa CHW', role: 'chw' },
      origin: { type: 'community', communityId: String(w.comA._id) },
      instructions: [{ title: 'Bring your antenatal card', bodyHa: 'Ki zo da katin ki.', templateVersion: 1 }],
    });
    expect(await ReferralEventModel.countDocuments({ referralId: r.id })).toBe(1);
  });

  it('enforces authorisation, consent, facility and template gates', async () => {
    expect((await w.refer(w.chwNo)).status).toBe(404); // not their patient
    const own = await w.registerAs(w.chwNo, true, 'Zainab Bello');
    const notAuthorised = await w.call(w.chwNo, 'post', '/referrals', { patientId: own.id, toFacilityId: String(w.facA._id), reason: 'Review' });
    expect(notAuthorised.status).toBe(403);
    expect(notAuthorised.body.error.message).toMatch(/not authorised to issue referrals/);

    const noShare = await w.registerAs(w.chwA, false, 'Maryam Sani');
    const noConsent = await w.call(w.chwA, 'post', '/referrals', { patientId: noShare.id, toFacilityId: String(w.facA._id), reason: 'Review' });
    expect(noConsent.status).toBe(409);
    expect(noConsent.body.error.message).toMatch(/share their details/);

    expect((await w.refer(w.chwA, { toFacilityId: String(w.facB._id) })).status).toBe(400);
    const draft = await w.call(w.progA, 'post', '/referral-templates', { title: 'Draft', body: 'Not reviewed yet' });
    expect((await w.refer(w.chwA, { instructionTemplateIds: [draft.body.data.id] })).status).toBe(400);
    expect((await w.refer(w.workerA)).status).toBe(403); // facility staff don't issue
  });

  it('is idempotent per clientId', async () => {
    const clientId = randomUUID();
    const a = await w.refer(w.chwA, { clientId });
    const b = await w.refer(w.chwA, { clientId });
    expect(b.status).toBe(200);
    expect(b.body.data).toMatchObject({ alreadyIssued: true, referral: { id: a.body.data.referral.id } });
  });
});

describe('closing the loop at the facility', () => {
  it('lets the receiving facility verify, receive, serve and complete — and only that facility', async () => {
    const r = (await w.refer(w.chwA)).body.data.referral;
    const sloppy = r.referralCode.toLowerCase().replace(/-/g, ' ');

    const queue = await w.call(w.workerA, 'get', '/referrals?open=true');
    expect(queue.body.data.map((x: { id: string }) => x.id)).toEqual([r.id]);
    expect((await w.call(w.workerA2, 'get', '/referrals')).body.data).toEqual([]);

    const verified = await w.call(w.workerA, 'get', `/referrals/code/${encodeURIComponent(sloppy)}`);
    expect(verified.status).toBe(200);
    expect(verified.body.data.patient).toEqual({
      id: w.patient.id, patientCode: 'CT-P-000001', fullName: 'Aisha Musa', sex: 'female', dateOfBirth: null,
      estimatedBirthYear: w.patient.estimatedBirthYear, carePathway: 'antenatal', expectedDeliveryDate: plusDays(100), deliveryDate: null,
    });
    expect(JSON.stringify(verified.body)).not.toContain('+234');
    const typo = r.referralCode.slice(0, -1) + (r.referralCode.endsWith('0') ? '1' : '0');
    expect((await w.call(w.workerA, 'get', `/referrals/code/${typo}`)).status).toBe(400);
    expect((await w.call(w.workerA2, 'get', `/referrals/code/${r.referralCode}`)).status).toBe(404);
    expect((await w.call(w.workerA, 'get', `/patients/${w.patient.id}`)).status).toBe(404);

    const path = `/referrals/${r.id}/status`;
    expect((await w.call(w.workerA, 'patch', path, { toStatus: 'patient_arrived', version: 0 })).body.data.arrival.by.name).toBe('Nurse Amina');
    expect((await w.call(w.workerA, 'patch', path, { toStatus: 'service_recorded', version: 1 })).status).toBe(400);
    expect((await w.call(w.workerA, 'patch', path, { toStatus: 'service_recorded', serviceSummary: 'Antenatal visit completed', version: 1 })).status).toBe(200);
    const done = await w.call(w.workerA, 'patch', path, { toStatus: 'completed', version: 2 });
    expect(done.body.data).toMatchObject({ status: 'completed', service: { summary: 'Antenatal visit completed' } });

    const history = await w.call(w.chwA, 'get', `/referrals/${r.id}/history`);
    expect(history.body.data.map((e: { toStatus: string }) => e.toStatus)).toEqual(['issued', 'patient_arrived', 'service_recorded', 'completed']);
    expect(history.body.data[1]).toMatchObject({ actor: { name: 'Nurse Amina', role: 'facility_worker' }, facilityId: String(w.facA._id) });

    const timeline = await w.call(w.chwA, 'get', `/patients/${w.patient.id}/history`);
    expect(timeline.body.data.filter((e: { kind: string }) => e.kind === 'referral')).toHaveLength(4);
  });

  it('rejects illegal transitions and actors with clear errors', async () => {
    const r = (await w.refer(w.chwA)).body.data.referral;
    const path = `/referrals/${r.id}/status`;
    const skip = await w.call(w.workerA, 'patch', path, { toStatus: 'completed', version: 0 });
    expect(skip.status).toBe(422);
    expect(skip.body.error.code).toBe('INVALID_TRANSITION');
    expect((await w.call(w.chwA, 'patch', path, { toStatus: 'patient_arrived', version: 0 })).status).toBe(403);
    expect((await w.call(w.workerA2, 'patch', path, { toStatus: 'patient_arrived', version: 0 })).status).toBe(404);
    expect((await w.call(w.progA, 'patch', path, { toStatus: 'patient_arrived', version: 0 })).status).toBe(403);
    expect((await w.call(w.chwA, 'patch', path, { toStatus: 'cancelled', version: 0 })).status).toBe(400); // reason needed

    await w.call(w.workerA, 'patch', path, { toStatus: 'patient_arrived', version: 0 });
    expect((await w.call(w.chwA, 'patch', path, { toStatus: 'cancelled', note: 'Changed mind', version: 1 })).status).toBe(422);
    expect((await w.call(w.workerA, 'patch', path, { toStatus: 'service_recorded', serviceSummary: 'Seen', version: 0 })).status).toBe(409);
    await w.call(w.workerA, 'patch', path, { toStatus: 'service_recorded', serviceSummary: 'Seen', version: 1 });
    expect((await w.call(w.workerA, 'patch', path, { toStatus: 'follow_up_required', version: 2 })).status).toBe(400);
    const fu = await w.call(w.workerA, 'patch', path, { toStatus: 'follow_up_required', note: 'Return in two weeks', version: 2 });
    expect(fu.body.data).toMatchObject({ status: 'follow_up_required', followUpNote: 'Return in two weeks' });
  });

  it('lets the issuer cancel before arrival, and only facility staff set priority', async () => {
    const r = (await w.refer(w.chwA)).body.data.referral;
    expect((await w.call(w.chwA, 'patch', `/referrals/${r.id}/priority`, { priority: 'urgent', version: 0 })).status).toBe(403);
    expect((await w.call(w.progA, 'patch', `/referrals/${r.id}/priority`, { priority: 'urgent', version: 0 })).status).toBe(403);
    const urgent = await w.call(w.workerA, 'patch', `/referrals/${r.id}/priority`, { priority: 'urgent', version: 0 });
    expect(urgent.body.data.priority).toBe('urgent');
    const cancelled = await w.call(w.chwA, 'patch', `/referrals/${r.id}/status`, { toStatus: 'cancelled', note: 'Patient relocated', version: 1 });
    expect(cancelled.body.data).toMatchObject({ status: 'cancelled', cancellation: { reason: 'Patient relocated', by: { id: String(w.chwA._id) } } });
  });
});

describe('visibility, overdue tracking and privacy', () => {
  it('scopes referrals to organisation, facility and the patient’s current CHW', async () => {
    const r = (await w.refer(w.chwA)).body.data.referral;
    expect((await w.call(w.progB, 'get', `/referrals/${r.id}`)).status).toBe(404);
    expect((await w.call(w.chwA2, 'get', `/referrals/${r.id}`)).status).toBe(404);
    expect((await w.call(w.progA, 'get', `/referrals/${r.id}`)).status).toBe(200);
    await w.call(w.progA, 'post', `/patients/${w.patient.id}/reassign`, { assignedChwId: String(w.chwA2._id), version: 0 });
    expect((await w.call(w.chwA2, 'get', `/referrals/${r.id}`)).status).toBe(200);
  });

  it('flags referrals still awaiting arrival after the expected date', async () => {
    await w.refer(w.chwA);
    w.clock.advance(8 * 86_400_000);
    const overdue = await w.call(w.workerA, 'get', '/referrals?overdue=true');
    expect(overdue.body.data).toHaveLength(1);
    expect(overdue.body.data[0].overdue).toBe(true);
  });

  it('reports referral counts on the overview', async () => {
    const r = (await w.refer(w.chwA)).body.data.referral;
    await w.refer(w.chwA, { toFacilityId: String(w.facA2._id) });
    await w.call(w.workerA, 'patch', `/referrals/${r.id}/status`, { toStatus: 'patient_arrived', version: 0 });
    const ov = await w.call(w.progA, 'get', '/analytics/overview');
    expect(ov.body.data).toMatchObject({ patients: { active: 1, total: 1 }, referrals: { open: 2, completed: 0, overdue: 0, total: 2 } });
    const fac = await w.call(w.workerA, 'get', '/referrals');
    expect(fac.body.data).toHaveLength(1);
  });

  it('keeps reasons, service summaries and notes out of the audit log', async () => {
    const r = (await w.refer(w.chwA, { reason: 'Swelling of the feet reported' })).body.data.referral;
    await w.call(w.workerA, 'patch', `/referrals/${r.id}/status`, { toStatus: 'patient_arrived', version: 0 });
    await w.call(w.workerA, 'patch', `/referrals/${r.id}/status`, { toStatus: 'service_recorded', serviceSummary: 'Blood pressure checked', version: 1 });
    const all = JSON.stringify(await AuditLogModel.find().lean());
    for (const s of ['Swelling', 'Blood pressure', 'Aisha']) expect(all).not.toContain(s);
    expect(await AuditLogModel.countDocuments({ action: 'referral.status' })).toBe(2);
  });
});
