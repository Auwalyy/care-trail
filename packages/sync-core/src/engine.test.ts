import { describe, expect, it } from 'vitest';
import { ApiError } from '@caretrail/api-client';
import type { SyncOpResult, SyncPullResponse, SyncPushRequest, SyncPushResponse } from '@caretrail/shared-types';
import { SyncEngine, backoffDelay } from './engine.js';
import { MemoryStore } from './memory-store.js';
import type { Transport } from './types.js';

const emptyPull = (cursor: string): SyncPullResponse => ({
  cursor, serverTime: cursor, patients: [], assignedPatientIds: [], households: [], referrals: [], appointments: [], followUps: [], visits: [], facilities: [], communities: [], templates: [],
  settings: { offlineSessionGraceDays: 14, consentTextVersion: null, referralExpectedArrivalDays: 7 }, canIssueReferrals: false,
});

class FakeTransport implements Transport {
  pushes: SyncPushRequest[] = [];
  pullsSince: (string | null)[] = [];
  /** Decide each op's result; default applied. */
  result: (opId: string) => SyncOpResult = (opId) => ({ opId, status: 'applied', serverId: `srv-${opId}`, entity: {}, replayed: false });
  failPush: Error | null = null;
  failPull: Error | null = null;
  async push(req: SyncPushRequest): Promise<SyncPushResponse> {
    this.pushes.push(req);
    if (this.failPush) throw this.failPush;
    return { results: req.operations.map((o) => this.result(o.opId)), serverTime: new Date().toISOString() };
  }
  async pull(since: string | null) {
    this.pullsSince.push(since);
    if (this.failPull) throw this.failPull;
    return emptyPull(`cursor-${this.pullsSince.length}`);
  }
}

const offline = () => new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Network unavailable' });
let t0 = Date.parse('2026-11-12T08:00:00Z');
const clock = () => new Date(t0);

function setup() {
  t0 = Date.parse('2026-11-12T08:00:00Z');
  const store = new MemoryStore();
  const transport = new FakeTransport();
  const engine = new SyncEngine(store, transport, { deviceId: 'device-123456', appVersion: '1.0.0', batchSize: 2, now: clock, random: () => 0.5 });
  const add = (n: number, extra: Partial<Parameters<MemoryStore['enqueue']>[0]> = {}) =>
    store.enqueue({ opId: `op-${n}`, opType: 'visit.create', entityLocalId: `visit-${n}`, payload: { n }, createdAt: new Date(t0 + n).toISOString(), ...extra });
  return { store, transport, engine, add };
}

describe('SyncEngine', () => {
  it('pushes in small batches in creation order, then pulls and saves the cursor', async () => {
    const { store, transport, engine, add } = setup();
    for (const n of [3, 1, 2]) add(n);
    const report = await engine.sync();
    expect(transport.pushes.map((p) => p.operations.map((o) => o.opId))).toEqual([['op-1', 'op-2'], ['op-3']]);
    expect(transport.pushes[0]!.pendingOperations).toBe(1);
    expect(report).toMatchObject({ outcome: 'ok', pushed: 3, applied: 3, pulled: true, remaining: 0 });
    expect(store.serverIds.get('visit-1')).toBe('srv-op-1');
    expect(store.cursor).toBe('cursor-1');
    await engine.sync();
    expect(transport.pullsSince).toEqual([null, 'cursor-1']);
  });

  it('holds dependent operations until what they depend on is synced', async () => {
    const { store, transport, engine, add } = setup();
    add(1, { opType: 'patient.register', entityLocalId: 'p1' });
    add(2, { dependsOn: 'op-1' });
    transport.result = (opId) => (opId === 'op-1' ? { opId, status: 'retry', error: { code: 'X', message: 'later' } } : { opId, status: 'applied', serverId: 's', entity: {}, replayed: false });
    await engine.sync();
    expect(transport.pushes.flatMap((p) => p.operations.map((o) => o.opId))).toEqual(['op-1']);
    expect(store.op('op-2').status).toBe('pending');
  });

  it('re-sends exactly the same op ids after a network failure, with exponential backoff', async () => {
    const { store, transport, engine, add } = setup();
    add(1);
    transport.failPush = offline();
    const r1 = await engine.sync();
    expect(r1).toMatchObject({ outcome: 'offline', deferred: 1 });
    expect(store.op('op-1')).toMatchObject({ status: 'failed', permanent: false, retryCount: 1, lastError: 'No connection to the server' });
    expect(store.op('op-1').nextAttemptAt).toBe(new Date(t0 + 15_000).toISOString());

    transport.failPush = null;
    await engine.sync(); // not yet due
    expect(transport.pushes).toHaveLength(1);
    t0 += 16_000;
    const r2 = await engine.sync();
    expect(transport.pushes.map((p) => p.operations[0]!.opId)).toEqual(['op-1', 'op-1']);
    expect(r2.applied).toBe(1);
    expect(store.op('op-1').status).toBe('synced');
  });

  it('computes backoff 15s, 30s, 60s … capped at 30 minutes, with jitter', () => {
    expect([1, 2, 3, 4].map((n) => backoffDelay(n, () => 0.5))).toEqual([15_000, 30_000, 60_000, 120_000]);
    expect(backoffDelay(20, () => 0.5)).toBe(30 * 60_000);
    expect(backoffDelay(1, () => 0)).toBe(12_000);
    expect(backoffDelay(1, () => 1)).toBe(18_000);
  });

  it('recovers ops left "syncing" by a crash', async () => {
    const { store, transport, engine, add } = setup();
    add(1);
    store.op('op-1').status = 'syncing'; // app killed mid-push
    await engine.sync();
    expect(transport.pushes[0]!.operations[0]!.opId).toBe('op-1');
    expect(store.op('op-1').status).toBe('synced');
  });

  it('records conflicts and permanent rejections for a person to review, without retrying them', async () => {
    const { store, transport, engine, add } = setup();
    add(1);
    add(2);
    transport.result = (opId) =>
      opId === 'op-1'
        ? { opId, status: 'conflict', error: { code: 'POSSIBLE_DUPLICATE', message: 'Similar person exists' }, current: { candidates: [] } }
        : { opId, status: 'rejected', error: { code: 'FORBIDDEN', message: 'Not allowed' } };
    const r = await engine.sync();
    expect(r).toMatchObject({ outcome: 'partial', conflicts: 1, rejected: 1 });
    expect(store.op('op-1')).toMatchObject({ status: 'conflict', conflict: { candidates: [] } });
    expect(store.op('op-2')).toMatchObject({ status: 'failed', permanent: true });
    t0 += 3_600_000;
    await engine.sync();
    expect(transport.pushes).toHaveLength(1);
  });

  it('keeps the old cursor when applying pulled data fails', async () => {
    const { store, engine } = setup();
    store.failNextApply = true;
    const r = await engine.sync();
    expect(r).toMatchObject({ outcome: 'offline', pulled: false });
    expect(store.cursor).toBeNull();
  });

  it('reports auth_required on 401 and keeps the ops queued', async () => {
    const { store, transport, engine, add } = setup();
    add(1);
    transport.failPush = new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'expired' });
    expect((await engine.sync()).outcome).toBe('auth_required');
    expect(store.op('op-1').status).toBe('failed');
  });

  it('shares one run between concurrent sync calls', async () => {
    const { transport, engine, add } = setup();
    add(1);
    await Promise.all([engine.sync(), engine.sync(), engine.sync()]);
    expect(transport.pushes).toHaveLength(1);
  });
});
