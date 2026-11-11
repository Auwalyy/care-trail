import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChwProfileModel } from '../src/modules/chws/chw.model.js';
import type { UserDoc } from '../src/modules/users/user.model.js';
import { buildTestApp, createCommunity, createFacility, createOrganisation, createUser, signIn, useTestDatabase } from './support.js';

useTestDatabase();

async function world() {
  const { app } = buildTestApp();
  const orgA = await createOrganisation('ORGA');
  const orgB = await createOrganisation('ORGB');
  const facA = await createFacility(orgA._id, 'FA');
  const facB = await createFacility(orgB._id, 'FB');
  const comA = await createCommunity(orgA._id, 'Gwale');
  const comB = await createCommunity(orgB._id, 'Fagge');
  const platform = await createUser('platform_admin');
  const progA = await createUser('programme_admin', { organisationId: orgA._id });
  const progB = await createUser('programme_admin', { organisationId: orgB._id });
  const facAdminA = await createUser('facility_admin', { organisationId: orgA._id, facilityId: facA._id });
  const workerA = await createUser('facility_worker', { organisationId: orgA._id, facilityId: facA._id });
  const chwA = await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id] });
  const bearers = new Map<UserDoc, string>();
  const as = async (u: UserDoc) => {
    if (!bearers.has(u)) bearers.set(u, (await signIn(app, u)).bearer);
    return bearers.get(u)!;
  };
  const call = async (u: UserDoc, method: 'get' | 'post' | 'patch' | 'put', path: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set('Authorization', await as(u));
    return body ? r.send(body) : r;
  };
  return { app, orgA, orgB, facA, facB, comA, comB, platform, progA, progB, facAdminA, workerA, chwA, call };
}

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  w = await world();
});

describe('organisations', () => {
  it('lets only platform admins create them, with unique upper-cased codes', async () => {
    const created = await w.call(w.platform, 'post', '/organisations', { name: 'Kano Maternal Programme', code: 'kmp-1', state: 'Kano' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: 'KMP-1', status: 'active', version: 0 });
    expect((await w.call(w.platform, 'post', '/organisations', { name: 'Other', code: 'KMP-1', state: 'Kano' })).status).toBe(409);
    expect((await w.call(w.progA, 'post', '/organisations', { name: 'Mine', code: 'MINE', state: 'Kano' })).status).toBe(403);
  });

  it('shows programme admins only their own organisation', async () => {
    expect((await w.call(w.progA, 'get', `/organisations/${String(w.orgB._id)}`)).status).toBe(404);
    expect((await w.call(w.progA, 'get', `/organisations/${String(w.orgA._id)}`)).status).toBe(200);
  });

  it('refuses to deactivate an organisation that still has user accounts', async () => {
    const res = await w.call(w.platform, 'patch', `/organisations/${String(w.orgA._id)}`, { status: 'inactive', version: 0 });
    expect(res.status).toBe(409);
    const empty = await createOrganisation('EMPTY');
    const ok = await w.call(w.platform, 'patch', `/organisations/${String(empty._id)}`, { status: 'inactive', version: 0 });
    expect(ok.body.data).toMatchObject({ status: 'inactive', version: 1 });
  });
});

describe('facilities', () => {
  const body = { name: 'Dala Primary Health Centre', code: 'phc-dala', lga: 'Dala', type: 'phc' };

  it('pins programme admins to their organisation', async () => {
    const res = await w.call(w.progA, 'post', '/facilities', body);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ organisationId: String(w.orgA._id), code: 'PHC-DALA' });
    expect((await w.call(w.progA, 'post', '/facilities', { ...body, code: 'X1', organisationId: String(w.orgB._id) })).status).toBe(403);
  });

  it('requires platform admins to choose an organisation', async () => {
    const res = await w.call(w.platform, 'post', '/facilities', body);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('organisationId');
    expect((await w.call(w.platform, 'post', '/facilities', { ...body, organisationId: String(w.orgB._id) })).status).toBe(201);
  });

  it('enforces code uniqueness per organisation only', async () => {
    await w.call(w.progA, 'post', '/facilities', body);
    expect((await w.call(w.progA, 'post', '/facilities', { ...body, name: 'Dup' })).status).toBe(409);
    expect((await w.call(w.progB, 'post', '/facilities', body)).status).toBe(201);
  });

  it('denies roles without facility:manage', async () => {
    for (const u of [w.facAdminA, w.workerA, w.chwA]) {
      expect((await w.call(u, 'post', '/facilities', { ...body, code: `C${Math.random().toString(36).slice(2, 6)}` })).status).toBe(403);
    }
  });

  it('uses optimistic concurrency and blocks deactivation while staff are assigned', async () => {
    const id = String(w.facA._id);
    const ok = await w.call(w.progA, 'patch', `/facilities/${id}`, { phone: '0803 000 1111', version: 0 });
    expect(ok.body.data).toMatchObject({ phone: '+2348030001111', version: 1 });
    const stale = await w.call(w.progA, 'patch', `/facilities/${id}`, { name: 'Renamed', version: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const blocked = await w.call(w.progA, 'patch', `/facilities/${id}`, { status: 'inactive', version: 1 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/2 staff account/);
  });

  it('returns 404 for out-of-scope facilities without revealing anything', async () => {
    const res = await w.call(w.progA, 'patch', `/facilities/${String(w.facB._id)}`, { status: 'inactive', version: 0 });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/staff/);
  });
});

describe('communities', () => {
  it('creates communities, rejects duplicates in the same LGA and protects ones with CHWs', async () => {
    const created = await w.call(w.progA, 'post', '/communities', { name: 'Kurna', lga: 'Dala', ward: '' });
    expect(created.status).toBe(201);
    expect(created.body.data.ward).toBeNull();
    expect((await w.call(w.progA, 'post', '/communities', { name: 'Kurna', lga: 'Dala' })).status).toBe(409);
    expect((await w.call(w.progA, 'post', '/communities', { name: 'Kurna', lga: 'Fagge' })).status).toBe(201);

    const blocked = await w.call(w.progA, 'patch', `/communities/${String(w.comA._id)}`, { status: 'inactive', version: 0 });
    expect(blocked.status).toBe(409);
    const free = await w.call(w.progA, 'patch', `/communities/${created.body.data.id}`, { status: 'inactive', version: 0 });
    expect(free.body.data.status).toBe('inactive');
  });
});

describe('community health workers', () => {
  it('creates a CHW account and profile together, with an activation link', async () => {
    const res = await w.call(w.progA, 'post', '/chws', {
      fullName: 'Aisha Bello',
      email: 'aisha.bello@example.org',
      phone: '08021234567',
      communityIds: [String(w.comA._id)],
      programmeAreas: ['Antenatal follow-up'],
      canIssueReferrals: true,
      supervisorUserId: String(w.facAdminA._id),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.chw).toMatchObject({
      programmeAreas: ['Antenatal follow-up'],
      canIssueReferrals: true,
      supervisorUserId: String(w.facAdminA._id),
      device: { lastSyncAt: null, appVersion: null, pendingOperations: null },
    });
    expect(res.body.data.chw.user).toMatchObject({ role: 'chw', status: 'pending_activation', preferredLanguage: 'ha' });
    expect(res.body.data.activation.url).toContain('mode=activate');
  });

  it('gives CHWs created through /users a default profile too', async () => {
    const res = await w.call(w.progA, 'post', '/users', { fullName: 'Musa Ali', email: 'musa@example.org', role: 'chw', communityIds: [String(w.comA._id)] });
    expect(res.status).toBe(201);
    const profile = await ChwProfileModel.findOne({ userId: res.body.data.user.id }).lean();
    expect(profile).toMatchObject({ canIssueReferrals: false, programmeAreas: [] });
  });

  it('validates supervisors and communities against the organisation', async () => {
    const base = { fullName: 'Test CHW', communityIds: [String(w.comA._id)] };
    const chwSup = await w.call(w.progA, 'post', '/chws', { ...base, email: 'a@x.org', supervisorUserId: String(w.chwA._id) });
    expect(chwSup.status).toBe(400);
    expect(chwSup.body.error.details[0].path).toBe('supervisorUserId');
    expect((await w.call(w.progA, 'post', '/chws', { ...base, email: 'b@x.org', supervisorUserId: String(w.progB._id) })).status).toBe(400);
    expect((await w.call(w.progA, 'post', '/chws', { ...base, email: 'c@x.org', communityIds: [String(w.comB._id)] })).status).toBe(400);
  });

  it('updates the profile and community assignment, lists within scope, and backfills old accounts', async () => {
    const id = String(w.chwA._id); // created without a profile — backfilled on first read
    const before = await w.call(w.progA, 'get', `/chws/${id}`);
    expect(before.status).toBe(200);
    expect(before.body.data.version).toBe(0);

    const comA2 = await createCommunity(w.orgA._id, 'Nassarawa');
    const upd = await w.call(w.progA, 'patch', `/chws/${id}`, { canIssueReferrals: true, communityIds: [String(comA2._id)], version: 0 });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ canIssueReferrals: true, version: 1 });
    expect(upd.body.data.user.communityIds).toEqual([String(comA2._id)]);
    expect((await w.call(w.progA, 'patch', `/chws/${id}`, { canIssueReferrals: false, version: 0 })).status).toBe(409);

    const listB = await w.call(w.progB, 'get', '/chws');
    expect(listB.body.data).toEqual([]);
    expect((await w.call(w.progB, 'get', `/chws/${id}`)).status).toBe(404);
    const byCommunity = await w.call(w.progA, 'get', `/chws?communityId=${String(comA2._id)}`);
    expect(byCommunity.body.data.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await w.call(w.facAdminA, 'get', '/chws')).status).toBe(403);
  });
});

describe('programme settings', () => {
  const values = {
    pilot: { communities: 2, facilities: 2, chws: 10, patients: 200, durationWeeks: 12, startDate: '2027-01-11' },
    referralExpectedArrivalDays: 5,
    appointmentOverdueGraceDays: 2,
    offlineSessionGraceDays: 10,
  };

  it('starts unconfigured, saves once, and then needs the current version', async () => {
    const initial = await w.call(w.progA, 'get', '/settings');
    expect(initial.body.data).toMatchObject({ configured: false, version: 0, pilot: { patients: null }, referralExpectedArrivalDays: 7 });

    const first = await w.call(w.progA, 'put', '/settings', { ...values, version: 0 });
    expect(first.body.data).toMatchObject({ configured: true, version: 1, pilot: { patients: 200 } });
    expect((await w.call(w.progA, 'put', '/settings', { ...values, version: 0 })).status).toBe(409);
    const second = await w.call(w.progA, 'put', '/settings', { ...values, offlineSessionGraceDays: 7, version: 1 });
    expect(second.body.data).toMatchObject({ offlineSessionGraceDays: 7, version: 2 });

    // Other organisations are unaffected.
    expect((await w.call(w.progB, 'get', '/settings')).body.data.configured).toBe(false);
  });

  it('validates ranges, requires an organisation for platform admins and denies other roles', async () => {
    expect((await w.call(w.progA, 'put', '/settings', { ...values, referralExpectedArrivalDays: 0, version: 0 })).status).toBe(400);
    expect((await w.call(w.platform, 'get', '/settings')).status).toBe(400);
    expect((await w.call(w.platform, 'get', `/settings?organisationId=${String(w.orgB._id)}`)).status).toBe(200);
    expect((await w.call(w.progA, 'get', `/settings?organisationId=${String(w.orgB._id)}`)).status).toBe(403);
    expect((await w.call(w.facAdminA, 'get', '/settings')).status).toBe(403);
  });
});

describe('audit log viewer', () => {
  it('scopes entries to the organisation, resolves actor names and filters by action', async () => {
    await w.call(w.progA, 'post', '/communities', { name: 'Kurna', lga: 'Dala' });
    await w.call(w.progB, 'post', '/communities', { name: 'Dorayi', lga: 'Gwale' });

    const a = await w.call(w.progA, 'get', '/audit-logs?action=community.');
    expect(a.status).toBe(200);
    expect(a.body.data).toHaveLength(1);
    expect(a.body.data[0]).toMatchObject({ action: 'community.create', actor: { id: String(w.progA._id), name: w.progA.fullName } });

    const all = await w.call(w.platform, 'get', '/audit-logs?action=community.');
    expect(all.body.data).toHaveLength(2);
    expect((await w.call(w.chwA, 'get', '/audit-logs')).status).toBe(403);
    expect((await w.call(w.progA, 'get', '/audit-logs?action=$where')).status).toBe(400);
  });
});

describe('analytics overview', () => {
  it('returns scoped counts and pilot targets, with no personal data', async () => {
    await w.call(w.progA, 'put', '/settings', {
      pilot: { communities: 2, facilities: 2, chws: 10, patients: 200, durationWeeks: 12, startDate: null },
      referralExpectedArrivalDays: 7, appointmentOverdueGraceDays: 1, offlineSessionGraceDays: 14, version: 0,
    });
    const res = await w.call(w.progA, 'get', '/analytics/overview');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      organisationId: String(w.orgA._id),
      facilities: { active: 1, total: 1 },
      communities: { active: 1, total: 1 },
      chws: { active: 1, pendingActivation: 0, total: 1 },
      staff: { active: 3, total: 3 },
      pilot: { chws: 10, patients: 200 },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/@|fullName|email/);

    const platform = await w.call(w.platform, 'get', '/analytics/overview');
    expect(platform.body.data).toMatchObject({ organisationId: null, facilities: { total: 2 }, pilot: null });
    expect((await w.call(w.chwA, 'get', '/analytics/overview')).status).toBe(403);
  });
});
