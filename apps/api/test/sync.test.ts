/**
 * Offline sync end to end: the real sync engine (@caretrail/sync-core) and HTTP transport talking to
 * the real API over a socket, against MongoDB — the same code path the mobile app uses.
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, ApiError } from '@caretrail/api-client';
import { isValidReferralCode, type SyncPullResponse, type SyncPushRequest, type SyncPushResponse } from '@caretrail/shared-types';
import { HttpTransport, MemoryStore, SyncEngine, type Transport } from '@caretrail/sync-core';
import { ChwProfileModel } from '../src/modules/chws/chw.model.js';
import { PatientModel } from '../src/modules/patients/patient.model.js';
import { ReferralModel } from '../src/modules/referrals/referral.model.js';
import { SyncOperationModel } from '../src/modules/sync/sync-operation.model.js';
import { VisitModel } from '../src/modules/visits/visit.model.js';
import { buildTestApp, createCommunity, createFacility, createOrganisation, createUser, signIn, useTestDatabase } from './support.js';

useTestDatabase();

const plusDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const consent = (share = true) => ({ purposes: { care_coordination: true, sms: false, voice: false, facility_sharing: share }, method: 'verbal', consentTextVersion: 'v1', language: 'ha' });

/** Wraps a transport with an on/off network switch. */
class FlakyTransport implements Transport {
  online = true;
  constructor(private readonly inner: Transport) {}
  private check() {
    if (!this.online) throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Network unavailable' });
  }
  async push(req: SyncPushRequest): Promise<SyncPushResponse> {
    this.check();
    return this.inner.push(req);
  }
  async pull(since: string | null): Promise<SyncPullResponse> {
    this.check();
    return this.inner.pull(since);
  }
}

let server: Server;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function world() {
  const { app } = buildTestApp();
  server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const org = await createOrganisation('ORGA');
  const fac = await createFacility(org._id, 'FA');
  const com = await createCommunity(org._id, 'Gwale');
  const prog = await createUser('programme_admin', { organisationId: org._id });
  const chw = await createUser('chw', { organisationId: org._id, communityIds: [com._id] });
  const chw2 = await createUser('chw', { organisationId: org._id, communityIds: [com._id] });
  await ChwProfileModel.create({ userId: chw._id, organisationId: org._id, canIssueReferrals: true });
  const { bearer } = await signIn(app, chw);
  const client = new ApiClient({ baseUrl: base, getAccessToken: () => bearer.slice(7) });
  const transport = new FlakyTransport(new HttpTransport(client));
  const store = new MemoryStore();
  let t = Date.now();
  const engine = new SyncEngine(store, transport, { deviceId: 'tecno-pop-5-001', appVersion: '1.0.0', now: () => new Date(t), random: () => 0.5 });
  const advance = (ms: number) => { t += ms; };
  const as = async (u: typeof prog) => (await signIn(app, u)).bearer;
  return { app, base, org, fac, com, prog, chw, chw2, client, transport, store, engine, advance, as };
}

function registerOp(store: MemoryStore, name = 'Aisha Musa', share = true) {
  const clientId = randomUUID();
  const op = store.enqueue({
    opId: randomUUID(), opType: 'patient.register', entityLocalId: clientId,
    payload: { clientId, fullName: name, sex: 'female', estimatedAge: 24, communityId: '', carePathway: 'antenatal', pathwayDetails: { expectedDeliveryDate: plusDays(100) }, consent: consent(share) },
  });
  return { clientId, op };
}

describe('offline-first synchronisation', () => {
  it('registers a patient, visit and referral offline, survives a network outage, then syncs without duplicates', async () => {
    const w = await world();
    const { clientId, op: reg } = registerOp(w.store);
    reg.payload.communityId = String(w.com._id);
    const visitId = randomUUID();
    const referralId = randomUUID();
    w.store.enqueue({ opId: randomUUID(), opType: 'visit.create', entityLocalId: visitId, dependsOn: reg.opId, payload: { clientId: visitId, patientId: `local:${clientId}`, visitDate: plusDays(0), outcome: 'met', followUpRequired: false } });
    w.store.enqueue({ opId: randomUUID(), opType: 'referral.create', entityLocalId: referralId, dependsOn: reg.opId, payload: { clientId: referralId, patientId: `local:${clientId}`, toFacilityId: String(w.fac._id), reason: 'Antenatal review' } });

    // No network in the community.
    w.transport.online = false;
    const offline = await w.engine.sync();
    expect(offline).toMatchObject({ outcome: 'offline', remaining: 3 });
    expect(await PatientModel.countDocuments()).toBe(0);

    // Back in coverage after the backoff period.
    w.transport.online = true;
    w.advance(20_000);
    const online = await w.engine.sync();
    expect(online).toMatchObject({ outcome: 'ok', applied: 3, pulled: true, remaining: 0 });
    const patientId = w.store.serverIds.get(clientId)!;
    expect(patientId).toMatch(/^[a-f0-9]{24}$/);
    const pulledReferral = [...w.store.data.referrals!.values()][0] as { referralCode: string; patient: { id: string } };
    expect(isValidReferralCode(pulledReferral.referralCode)).toBe(true);
    expect(pulledReferral.patient.id).toBe(patientId);
    expect(w.store.data.patients!.has(patientId)).toBe(true);

    // The response to the push was "lost": the device sends the very same operations again.
    const replay = await w.transport.push({ deviceId: 'tecno-pop-5-001', appVersion: '1.0.0', pendingOperations: 0, operations: w.store.outbox.map((o) => ({ opId: o.opId, opType: o.opType, targetId: o.targetId, payload: o.payload, createdAt: o.createdAt })) });
    expect(replay.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);
    expect(replay.results.every((r) => r.status === 'applied' && r.replayed)).toBe(true);
    expect(await PatientModel.countDocuments()).toBe(1);
    expect(await VisitModel.countDocuments()).toBe(1);
    expect(await ReferralModel.countDocuments()).toBe(1);

    // Device status is visible to supervisors.
    const profile = await ChwProfileModel.findOne({ userId: w.chw._id }).lean();
    expect(profile?.device).toMatchObject({ appVersion: '1.0.0', pendingOperations: 0 });
    expect(profile?.device.lastSyncAt).toBeInstanceOf(Date);
  });

  it('returns retry for references not yet synchronised, and keeps ids unique per user', async () => {
    const w = await world();
    const res = await w.transport.push({
      deviceId: 'device-x-001', appVersion: '1', pendingOperations: 0,
      operations: [{ opId: randomUUID(), opType: 'visit.create', payload: { clientId: randomUUID(), patientId: `local:${randomUUID()}`, visitDate: plusDays(0), outcome: 'met' }, createdAt: new Date().toISOString() }],
    });
    expect(res.results[0]).toMatchObject({ status: 'retry', error: { code: 'DEPENDENCY_PENDING' } });
    expect(await SyncOperationModel.countDocuments()).toBe(0); // retries are not recorded as final
  });

  it('turns stale updates and possible duplicates into conflicts for review, and invalid data into rejections', async () => {
    const w = await world();
    const { clientId, op } = registerOp(w.store);
    op.payload.communityId = String(w.com._id);
    await w.engine.sync();
    const patientId = w.store.serverIds.get(clientId)!;

    // Meanwhile the programme officer corrects the phone number online (version 0 → 1).
    await request(w.app).patch(`/api/v1/patients/${patientId}`).set('Authorization', await w.as(w.prog)).send({ phone: '0803 111 2222', version: 0 });
    // The CHW edited the same record offline, based on version 0.
    const stale = w.store.enqueue({ opId: randomUUID(), opType: 'patient.update', entityLocalId: clientId, targetId: patientId, payload: { fullName: 'Aisha M. Musa', version: 0 } });
    const dup = registerOp(w.store, 'Musa Aisha');
    dup.op.payload.communityId = String(w.com._id);
    const noShare = registerOp(w.store, 'Zainab Bello', false);
    noShare.op.payload.communityId = String(w.com._id);
    const badReferral = w.store.enqueue({ opId: randomUUID(), opType: 'referral.create', entityLocalId: randomUUID(), dependsOn: noShare.op.opId, payload: { clientId: randomUUID(), patientId: `local:${noShare.clientId}`, toFacilityId: String(w.fac._id), reason: 'Review' } });

    const r = await w.engine.sync();
    expect(r).toMatchObject({ conflicts: 2, rejected: 1, outcome: 'partial' });
    expect(w.store.op(stale.opId)).toMatchObject({ status: 'conflict', lastError: expect.stringMatching(/changed by someone else/) });
    expect((w.store.op(stale.opId).conflict as { current: { phone: string } }).current.phone).toBe('+2348031112222');
    expect(w.store.op(dup.op.opId)).toMatchObject({ status: 'conflict' });
    expect((w.store.op(dup.op.opId).conflict as { candidates: { fullName: string }[] }).candidates[0]!.fullName).toBe('Aisha Musa');
    expect(w.store.op(badReferral.opId)).toMatchObject({ status: 'failed', permanent: true, lastError: expect.stringMatching(/share their details/) });

    // Nothing was silently overwritten.
    expect((await PatientModel.findById(patientId).lean())?.fullName).toBe('Aisha Musa');
  });

  it('pulls incrementally and purges patients reassigned away from the device', async () => {
    const w = await world();
    const a = registerOp(w.store);
    a.op.payload.communityId = String(w.com._id);
    await w.engine.sync();
    const patientId = w.store.serverIds.get(a.clientId)!;
    const firstCursor = w.store.cursor;

    const again = await w.transport.pull(firstCursor);
    expect(again.patients).toHaveLength(1); // within the overlap window — harmless, upserts are idempotent
    const later = await w.transport.pull(new Date(Date.now() + 60_000).toISOString());
    expect(later.patients).toHaveLength(0);
    expect(later.assignedPatientIds).toEqual([patientId]);

    await request(w.app).post(`/api/v1/patients/${patientId}/reassign`).set('Authorization', await w.as(w.prog)).send({ assignedChwId: String(w.chw2._id), version: 0 });
    await w.engine.sync();
    expect(w.store.data.patients!.has(patientId)).toBe(false);
    expect(w.store.assignedPatientIds).toEqual([]);
  });

  it('is only available to community health workers', async () => {
    const w = await world();
    const res = await request(w.app).get('/api/v1/sync/pull').set('Authorization', await w.as(w.prog));
    expect(res.status).toBe(403);
    const bad = await request(w.app).post('/api/v1/sync/push').set('Authorization', await w.as(w.chw)).send({ deviceId: 'x', operations: [] });
    expect(bad.status).toBe(400);
  });
});
