import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { ChwProfileModel } from '../src/modules/chws/chw.model.js';
import { FollowUpTaskModel } from '../src/modules/follow-ups/follow-up.model.js';
import { ReferralEventModel } from '../src/modules/referrals/referral-event.model.js';
import type { UserDoc } from '../src/modules/users/user.model.js';
import { buildTestApp, createCommunity, createFacility, createOrganisation, createUser, signIn, useTestDatabase } from './support.js';

useTestDatabase();

const DAY = 86_400_000;
const plusDays = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

async function world() {
  const { app, clock } = buildTestApp();
  const orgA = await createOrganisation('ORGA');
  const facA = await createFacility(orgA._id, 'FA');
  const facA2 = await createFacility(orgA._id, 'FA2');
  const comA = await createCommunity(orgA._id, 'Gwale');
  const progA = await createUser('programme_admin', { organisationId: orgA._id });
  const workerA = await createUser('facility_worker', { organisationId: orgA._id, facilityId: facA._id, fullName: 'Nurse Amina' });
  const workerA2 = await createUser('facility_worker', { organisationId: orgA._id, facilityId: facA2._id });
  const chwA = await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id], fullName: 'Hauwa CHW' });
  const chwA2 = await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id] });
  await ChwProfileModel.create([
    { userId: chwA._id, organisationId: orgA._id, canIssueReferrals: true, supervisorUserId: workerA._id },
    { userId: chwA2._id, organisationId: orgA._id, canIssueReferrals: true },
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
  const register = async (u: UserDoc, name: string) =>
    (
      await call(u, 'post', '/patients', {
        fullName: name, sex: 'female', estimatedAge: 25, communityId: String(comA._id), carePathway: 'antenatal',
        pathwayDetails: { expectedDeliveryDate: plusDays(90) }, confirmNotDuplicate: true,
        consent: { purposes: { care_coordination: true, sms: false, voice: false, facility_sharing: true }, method: 'verbal', consentTextVersion: 'v1', language: 'ha' },
      })
    ).body.data.patient as { id: string; version: number };
  const patient = await register(chwA, 'Aisha Musa');
  const book = (u: UserDoc, body: Record<string, unknown> = {}) => call(u, 'post', '/appointments', { patientId: patient.id, facilityId: String(facA._id), category: 'antenatal', scheduledFor: plusDays(1), ...body });
  const runCheck = () => call(progA, 'post', '/follow-ups/missed-care/run');
  return { app, clock, orgA, facA, facA2, comA, progA, workerA, workerA2, chwA, chwA2, call, register, patient, book, runCheck };
}

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  w = await world();
});

describe('appointments', () => {
  it('lets CHWs book for their own patients and facility staff book follow-ups only for linked patients', async () => {
    const res = await w.book(w.chwA);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'scheduled', category: 'antenatal', facilityId: String(w.facA._id), patient: { fullName: 'Aisha Musa' } });
    expect(JSON.stringify(res.body)).not.toMatch(/phone|consent/);

    expect((await w.book(w.chwA2)).status).toBe(404);
    expect((await w.book(w.chwA, { scheduledFor: plusDays(-1) })).status).toBe(400);
    const other = await w.register(w.chwA2, 'Zainab Bello');
    expect((await w.call(w.workerA, 'post', '/appointments', { patientId: other.id, category: 'postnatal', scheduledFor: plusDays(3) })).status).toBe(404);
    const followUp = await w.call(w.workerA, 'post', '/appointments', { patientId: w.patient.id, category: 'antenatal', scheduledFor: plusDays(14) });
    expect(followUp.status).toBe(201);
    expect(followUp.body.data.facilityId).toBe(String(w.facA._id));
    expect((await w.call(w.workerA, 'post', '/appointments', { patientId: w.patient.id, facilityId: String(w.facA2._id), category: 'other', scheduledFor: plusDays(5) })).status).toBe(403);
    expect((await w.call(w.workerA2, 'get', `/appointments/${res.body.data.id}`)).status).toBe(404);
  });

  it('records attendance (facility staff only), reschedules and cancels with reasons', async () => {
    const a = (await w.book(w.chwA)).body.data;
    expect((await w.call(w.chwA, 'post', `/appointments/${a.id}/attendance`, { outcome: 'attended', version: 0 })).status).toBe(403);
    const moved = await w.call(w.chwA, 'patch', `/appointments/${a.id}`, { scheduledFor: plusDays(4), version: 0 });
    expect(moved.body.data).toMatchObject({ scheduledFor: plusDays(4), reschedules: [{ from: plusDays(1), to: plusDays(4) }] });
    const attended = await w.call(w.workerA, 'post', `/appointments/${a.id}/attendance`, { outcome: 'attended', version: 1 });
    expect(attended.body.data).toMatchObject({ status: 'attended', attendance: { by: { name: 'Nurse Amina' } } });
    expect((await w.call(w.chwA, 'post', `/appointments/${a.id}/cancel`, { reason: 'Moved', version: 2 })).status).toBe(409);

    const b = (await w.book(w.chwA, { scheduledFor: plusDays(2) })).body.data;
    expect((await w.call(w.chwA, 'post', `/appointments/${b.id}/cancel`, { version: 0 })).status).toBe(400);
    expect((await w.call(w.chwA, 'post', `/appointments/${b.id}/cancel`, { reason: 'Travelling', version: 0 })).body.data.status).toBe('cancelled');
  });
});

describe('missed-care check', () => {
  it('marks missed appointments after the grace period, creates one task, and is idempotent', async () => {
    const a = (await w.book(w.chwA)).body.data;
    w.clock.advance(2 * DAY); // date + 1 day: still within the 1-day grace
    expect((await w.runCheck()).body.data.appointmentsMarkedMissed).toBe(0);
    w.clock.advance(1 * DAY);
    const first = await w.runCheck();
    expect(first.body.data).toMatchObject({ appointmentsMarkedMissed: 1, tasksCreated: 1 });
    const second = await w.runCheck();
    expect(second.body.data).toMatchObject({ appointmentsMarkedMissed: 0, referralsExpired: 0, tasksCreated: 0 });
    expect(await FollowUpTaskModel.countDocuments()).toBe(1);

    const tasks = await w.call(w.chwA, 'get', '/follow-ups?open=true');
    expect(tasks.body.data).toHaveLength(1);
    expect(tasks.body.data[0]).toMatchObject({ reason: 'missed_appointment', assignedChw: { id: String(w.chwA._id) }, createdBy: null, source: { type: 'appointment', label: a.scheduledFor } });

    // The patient turns up late: attendance resolves the task automatically.
    await w.call(w.workerA, 'post', `/appointments/${a.id}/attendance`, { outcome: 'attended', version: 1 });
    const after = await FollowUpTaskModel.findOne().lean();
    expect(after).toMatchObject({ status: 'resolved', outcome: 'Patient attended' });
    expect(after?.openKey).toBeUndefined();
  });

  it('expires referrals awaiting arrival and creates a task; arrival later closes it', async () => {
    const r = (await w.call(w.chwA, 'post', '/referrals', { patientId: w.patient.id, toFacilityId: String(w.facA._id), reason: 'Antenatal review' })).body.data.referral;
    w.clock.advance(8 * DAY);
    const run = await w.runCheck();
    expect(run.body.data).toMatchObject({ referralsExpired: 1, tasksCreated: 1 });
    const ev = await ReferralEventModel.findOne({ referralId: r.id, toStatus: 'expired' }).lean();
    expect(ev).toMatchObject({ actorId: null, actorRole: 'system', source: 'system' });
    expect((await w.runCheck()).body.data.tasksCreated).toBe(0);

    const late = await w.call(w.workerA, 'patch', `/referrals/${r.id}/status`, { toStatus: 'patient_arrived', version: 1 });
    expect(late.body.data.status).toBe('patient_arrived');
    expect(await FollowUpTaskModel.countDocuments({ status: 'resolved', outcome: 'Patient arrived at the facility' })).toBe(1);
  });

  it('turns "further follow-up required" into a CHW task carrying the facility note', async () => {
    const r = (await w.call(w.chwA, 'post', '/referrals', { patientId: w.patient.id, toFacilityId: String(w.facA._id), reason: 'Review' })).body.data.referral;
    await w.call(w.workerA, 'patch', `/referrals/${r.id}/status`, { toStatus: 'patient_arrived', version: 0 });
    await w.call(w.workerA, 'patch', `/referrals/${r.id}/status`, { toStatus: 'service_recorded', serviceSummary: 'Seen', version: 1 });
    await w.call(w.workerA, 'patch', `/referrals/${r.id}/status`, { toStatus: 'follow_up_required', note: 'Check she takes the supplements', version: 2 });
    expect((await w.runCheck()).body.data.tasksCreated).toBe(1);
    const t = (await w.call(w.chwA, 'get', '/follow-ups?reason=referral_incomplete')).body.data[0];
    expect(t).toMatchObject({ note: 'Check she takes the supplements', source: { type: 'referral', label: r.referralCode } });
  });

  it('creates no tasks for inactive patients and refuses non-admins', async () => {
    await w.book(w.chwA);
    await w.call(w.chwA, 'post', `/patients/${w.patient.id}/status`, { status: 'transferred', reason: 'Moved away', version: w.patient.version });
    w.clock.advance(5 * DAY);
    expect((await w.runCheck()).body.data).toMatchObject({ appointmentsMarkedMissed: 1, tasksCreated: 0 });
    expect((await w.call(w.chwA, 'post', '/follow-ups/missed-care/run')).status).toBe(403);
  });
});

describe('follow-up tasks', () => {
  async function missedTask() {
    await w.book(w.chwA);
    w.clock.advance(3 * DAY);
    await w.runCheck();
    return (await w.call(w.chwA, 'get', '/follow-ups')).body.data[0] as { id: string; version: number };
  }

  it('tracks contact attempts through to resolution with the shared state machine', async () => {
    const t = await missedTask();
    const noAnswer = await w.call(w.chwA, 'post', `/follow-ups/${t.id}/attempts`, { method: 'call', reached: false, version: 0 });
    expect(noAnswer.body.data).toMatchObject({ status: 'in_progress', attempts: [{ method: 'call', reached: false, by: { name: 'Hauwa CHW' } }] });
    const reached = await w.call(w.chwA, 'post', `/follow-ups/${t.id}/attempts`, { method: 'visit', reached: true, response: 'Will go tomorrow', version: 1 });
    expect(reached.body.data.status).toBe('contacted');
    expect((await w.call(w.chwA, 'post', `/follow-ups/${t.id}/resolve`, { version: 2 })).status).toBe(400);
    const done = await w.call(w.chwA, 'post', `/follow-ups/${t.id}/resolve`, { outcome: 'Rebooked for next week', version: 2 });
    expect(done.body.data).toMatchObject({ status: 'resolved', outcome: 'Rebooked for next week' });
    expect((await w.call(w.chwA, 'post', `/follow-ups/${t.id}/resolve`, { outcome: 'again', version: 3 })).status).toBe(422);

    const audit = JSON.stringify(await AuditLogModel.find({ action: /^followup/ }).lean());
    expect(audit).not.toContain('Will go tomorrow');
    expect(audit).not.toContain('Rebooked');
  });

  it('escalates to the supervisor, or to programme admins when there is none', async () => {
    const t = await missedTask();
    const esc = await w.call(w.chwA, 'post', `/follow-ups/${t.id}/escalate`, { notes: 'Family refuses visits', version: 0 });
    expect(esc.body.data).toMatchObject({ status: 'escalated', escalation: { to: [{ id: String(w.workerA._id), name: 'Nurse Amina' }] } });
    expect((await w.call(w.workerA, 'get', '/follow-ups')).body.data.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect((await w.call(w.workerA2, 'get', `/follow-ups/${t.id}`)).status).toBe(404);
    expect((await w.call(w.chwA2, 'get', `/follow-ups/${t.id}`)).status).toBe(404);

    const p2 = await w.register(w.chwA2, 'Zainab Bello');
    const manual = await w.call(w.chwA2, 'post', '/follow-ups', { patientId: p2.id, dueOn: plusDays(2), note: 'Check on the baby' });
    const esc2 = await w.call(w.chwA2, 'post', `/follow-ups/${manual.body.data.id}/escalate`, { notes: 'Cannot reach', version: 0 });
    expect(esc2.body.data.escalation.to.map((u: { id: string }) => u.id)).toEqual([String(w.progA._id)]);
  });

  it('creates manual tasks idempotently and moves open tasks with the patient on reassignment', async () => {
    const clientId = randomUUID();
    const a = await w.call(w.chwA, 'post', '/follow-ups', { clientId, patientId: w.patient.id, dueOn: plusDays(3), note: 'Confirm transport' });
    const b = await w.call(w.chwA, 'post', '/follow-ups', { clientId, patientId: w.patient.id, dueOn: plusDays(3), note: 'Confirm transport' });
    expect(a.body.data.id).toBe(b.body.data.id);
    await missedTask();

    await w.call(w.progA, 'post', `/patients/${w.patient.id}/reassign`, { assignedChwId: String(w.chwA2._id), version: 0 });
    expect((await w.call(w.chwA2, 'get', '/follow-ups?open=true')).body.data).toHaveLength(2);
    expect((await w.call(w.chwA, 'get', '/follow-ups?open=true')).body.data).toHaveLength(0);
  });

  it('reports appointment and follow-up figures on the overview', async () => {
    const t = await missedTask();
    await w.call(w.chwA, 'post', `/follow-ups/${t.id}/attempts`, { method: 'call', reached: true, version: 0 });
    await w.call(w.chwA, 'post', `/follow-ups/${t.id}/resolve`, { outcome: 'Rebooked', version: 1 });
    const ov = await w.call(w.progA, 'get', '/analytics/overview');
    expect(ov.body.data).toMatchObject({ appointments: { missed: 1, total: 1 }, followUps: { open: 0, resolved: 1, reachedRate: 100 } });
  });
});
