import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '../src/modules/users/user.model.js';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import {
  buildTestApp,
  createCommunity,
  createFacility,
  createOrganisation,
  createUser,
  login,
  signIn,
  tokenFromLink,
  useTestDatabase,
} from './support.js';

useTestDatabase();

/** Two organisations, each with a facility and a community, and one user per role. */
async function world() {
  const { app, clock } = buildTestApp();
  const orgA = await createOrganisation('ORGA');
  const orgB = await createOrganisation('ORGB');
  const facA = await createFacility(orgA._id, 'FA');
  const facA2 = await createFacility(orgA._id, 'FA2');
  const facB = await createFacility(orgB._id, 'FB');
  const comA = await createCommunity(orgA._id, 'Gwale');
  const comB = await createCommunity(orgB._id, 'Fagge');

  const platform = await createUser('platform_admin');
  const progA = await createUser('programme_admin', { organisationId: orgA._id });
  const progB = await createUser('programme_admin', { organisationId: orgB._id });
  const facAdminA = await createUser('facility_admin', { organisationId: orgA._id, facilityId: facA._id });
  const facWorkerA = await createUser('facility_worker', { organisationId: orgA._id, facilityId: facA._id });
  const facWorkerA2 = await createUser('facility_worker', { organisationId: orgA._id, facilityId: facA2._id });
  const chwA = await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id] });
  const chwB = await createUser('chw', { organisationId: orgB._id, communityIds: [comB._id] });

  const as = async (u: UserDoc) => (await signIn(app, u)).bearer;
  return { app, clock, orgA, orgB, facA, facA2, facB, comA, comB, platform, progA, progB, facAdminA, facWorkerA, facWorkerA2, chwA, chwB, as };
}

type World = Awaited<ReturnType<typeof world>>;
let w: World;
beforeEach(async () => {
  w = await world();
});

const ids = (res: request.Response) => (res.body.data as { id: string }[]).map((u) => u.id).sort();

describe('user listing and data isolation', () => {
  it('denies roles without user:read', async () => {
    for (const u of [w.chwA, w.facWorkerA]) {
      const res = await request(w.app).get('/api/v1/users').set('Authorization', await w.as(u));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('confines programme admins to their organisation', async () => {
    const res = await request(w.app).get('/api/v1/users?pageSize=100').set('Authorization', await w.as(w.progA));
    expect(res.status).toBe(200);
    const orgAUsers = [w.progA, w.facAdminA, w.facWorkerA, w.facWorkerA2, w.chwA].map((u) => String(u._id)).sort();
    expect(ids(res)).toEqual(orgAUsers);

    // Asking for another organisation's users explicitly does not widen the scope.
    const sneaky = await request(w.app)
      .get(`/api/v1/users?organisationId=${String(w.orgB._id)}`)
      .set('Authorization', await w.as(w.progA));
    expect(ids(sneaky)).toEqual(orgAUsers);

    const other = await request(w.app).get(`/api/v1/users/${String(w.chwB._id)}`).set('Authorization', await w.as(w.progA));
    expect(other.status).toBe(404);
  });

  it('confines facility admins to their facility', async () => {
    const res = await request(w.app).get('/api/v1/users').set('Authorization', await w.as(w.facAdminA));
    expect(ids(res)).toEqual([w.facAdminA, w.facWorkerA].map((u) => String(u._id)).sort());
  });

  it('lets platform admins see everyone, with filters, search and pagination', async () => {
    const bearer = await w.as(w.platform);
    const all = await request(w.app).get('/api/v1/users?pageSize=2&page=1').set('Authorization', bearer);
    expect(all.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 8, totalPages: 4 });
    const chws = await request(w.app).get('/api/v1/users?role=chw').set('Authorization', bearer);
    expect(ids(chws)).toEqual([w.chwA, w.chwB].map((u) => String(u._id)).sort());
    const search = await request(w.app).get(`/api/v1/users?q=${encodeURIComponent(w.chwB.email.slice(0, 12))}`).set('Authorization', bearer);
    expect(ids(search)).toEqual([String(w.chwB._id)]);
  });

  it('never exposes credentials or lockout state', async () => {
    const res = await request(w.app).get('/api/v1/users?pageSize=100').set('Authorization', await w.as(w.platform));
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|failedLoginCount|lockedUntil|sessionVersion/);
  });

  it('rejects invalid ids and query values', async () => {
    const bearer = await w.as(w.platform);
    expect((await request(w.app).get('/api/v1/users/not-an-id').set('Authorization', bearer)).status).toBe(400);
    expect((await request(w.app).get('/api/v1/users?sort=$where').set('Authorization', bearer)).status).toBe(400);
  });
});

describe('creating users', () => {
  it('lets a programme admin onboard a CHW who then activates and signs in', async () => {
    const res = await request(w.app)
      .post('/api/v1/users')
      .set('Authorization', await w.as(w.progA))
      .send({ email: 'Hauwa.Musa@Example.org', fullName: 'Hauwa Musa', role: 'chw', phone: '0803 123 4567', communityIds: [String(w.comA._id)] });

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.user).toMatchObject({
      email: 'hauwa.musa@example.org',
      status: 'pending_activation',
      organisationId: String(w.orgA._id),
      phone: '+2348031234567',
    });
    expect(res.body.data.activation.url).toContain('mode=activate');

    expect((await login(w.app, 'hauwa.musa@example.org', 'whatever-password')).status).toBe(401);
    const activate = await request(w.app)
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenFromLink(res.body.data.activation.url), password: 'hauwa-strong-pass' });
    expect(activate.body.data).toEqual({ activated: true });
    expect((await login(w.app, 'hauwa.musa@example.org', 'hauwa-strong-pass')).status).toBe(200);

    const audit = await AuditLogModel.findOne({ action: 'user.create' }).lean();
    expect(audit?.actorId?.equals(w.progA._id)).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/hauwa|\+234/i);
  });

  it('blocks role escalation and cross-organisation assignment', async () => {
    const bearer = await w.as(w.progA);
    const post = (body: object) => request(w.app).post('/api/v1/users').set('Authorization', bearer).send({ fullName: 'X Y', email: `x${Math.random()}@ex.org`, ...body });

    expect((await post({ role: 'platform_admin' })).status).toBe(403);
    expect((await post({ role: 'programme_admin' })).status).toBe(403);
    expect((await post({ role: 'chw', organisationId: String(w.orgB._id), communityIds: [String(w.comB._id)] })).status).toBe(403);

    const foreignCommunity = await post({ role: 'chw', communityIds: [String(w.comB._id)] });
    expect(foreignCommunity.status).toBe(400);
    expect(foreignCommunity.body.error.details[0].path).toBe('communityIds');
    expect((await post({ role: 'facility_worker', facilityId: String(w.facB._id) })).status).toBe(400);
    expect((await post({ role: 'chw', communityIds: [] })).status).toBe(400);
    expect((await post({ role: 'chw', communityIds: [String(w.comA._id)], facilityId: String(w.facA._id) })).status).toBe(400);
  });

  it('limits facility admins to facility workers in their own facility', async () => {
    const bearer = await w.as(w.facAdminA);
    const post = (body: object) => request(w.app).post('/api/v1/users').set('Authorization', bearer).send({ fullName: 'Nurse A', email: `n${Math.random()}@ex.org`, ...body });

    const ok = await post({ role: 'facility_worker' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.user.facilityId).toBe(String(w.facA._id));
    expect((await post({ role: 'facility_worker', facilityId: String(w.facA2._id) })).status).toBe(403);
    expect((await post({ role: 'chw', communityIds: [String(w.comA._id)] })).status).toBe(403);
  });

  it('lets platform admins create programme admins for any organisation', async () => {
    const res = await request(w.app)
      .post('/api/v1/users')
      .set('Authorization', await w.as(w.platform))
      .send({ fullName: 'Programme Lead', email: 'lead@orgb.org', role: 'programme_admin', organisationId: String(w.orgB._id) });
    expect(res.status).toBe(201);
    expect(res.body.data.user.organisationId).toBe(String(w.orgB._id));
  });

  it('rejects duplicate emails', async () => {
    const res = await request(w.app)
      .post('/api/v1/users')
      .set('Authorization', await w.as(w.progA))
      .send({ fullName: 'Dup', email: w.chwA.email.toUpperCase(), role: 'chw', communityIds: [String(w.comA._id)] });
    expect(res.status).toBe(409);
  });
});

describe('updating users', () => {
  it('uses optimistic concurrency', async () => {
    const bearer = await w.as(w.progA);
    const first = await request(w.app).patch(`/api/v1/users/${String(w.chwA._id)}`).set('Authorization', bearer).send({ fullName: 'Renamed', version: 0 });
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(1);
    const stale = await request(w.app).patch(`/api/v1/users/${String(w.chwA._id)}`).set('Authorization', bearer).send({ fullName: 'Again', version: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.details.current.fullName).toBe('Renamed');
  });

  it('cannot touch users outside scope, higher roles, or yourself', async () => {
    const bearer = await w.as(w.progA);
    expect((await request(w.app).patch(`/api/v1/users/${String(w.chwB._id)}`).set('Authorization', bearer).send({ fullName: 'Xy Zed', version: 0 })).status).toBe(404);
    expect((await request(w.app).patch(`/api/v1/users/${String(w.progA._id)}`).set('Authorization', bearer).send({ fullName: 'Me', version: 0 })).status).toBe(403);
    const facBearer = await w.as(w.facAdminA);
    expect((await request(w.app).patch(`/api/v1/users/${String(w.facWorkerA2._id)}`).set('Authorization', facBearer).send({ fullName: 'Xy Zed', version: 0 })).status).toBe(404);
  });

  it('reassigns a CHW only to communities in the same organisation', async () => {
    const bearer = await w.as(w.progA);
    const comA2 = await createCommunity(w.orgA._id, 'Nassarawa');
    const ok = await request(w.app).patch(`/api/v1/users/${String(w.chwA._id)}`).set('Authorization', bearer).send({ communityIds: [String(comA2._id)], version: 0 });
    expect(ok.body.data.communityIds).toEqual([String(comA2._id)]);
    const bad = await request(w.app).patch(`/api/v1/users/${String(w.chwA._id)}`).set('Authorization', bearer).send({ communityIds: [String(w.comB._id)], version: 1 });
    expect(bad.status).toBe(400);
  });
});

describe('activation status and password links', () => {
  it('deactivation revokes access immediately; reactivation restores it', async () => {
    const chw = await signIn(w.app, w.chwA);
    const admin = await w.as(w.progA);

    const off = await request(w.app).post(`/api/v1/users/${String(w.chwA._id)}/status`).set('Authorization', admin).send({ status: 'inactive', version: 0 });
    expect(off.body.data.status).toBe('inactive');
    expect((await request(w.app).get('/api/v1/auth/me').set('Authorization', chw.bearer)).status).toBe(401);
    expect((await request(w.app).post('/api/v1/auth/refresh').send({ refreshToken: chw.refreshToken })).status).toBe(401);
    expect((await login(w.app, w.chwA.email)).status).toBe(401);

    const on = await request(w.app).post(`/api/v1/users/${String(w.chwA._id)}/status`).set('Authorization', admin).send({ status: 'active', version: 1 });
    expect(on.body.data.status).toBe('active');
    expect((await login(w.app, w.chwA.email)).status).toBe(200);
    expect(await AuditLogModel.countDocuments({ action: { $in: ['user.deactivate', 'user.reactivate'] } })).toBe(2);
  });

  it('issues an activation link for pending users and a reset link for active ones', async () => {
    const admin = await w.as(w.progA);
    const pending = await createUser('chw', { organisationId: w.orgA._id, communityIds: [w.comA._id] }, null);

    const act = await request(w.app).post(`/api/v1/users/${String(pending._id)}/password-link`).set('Authorization', admin);
    expect(act.status).toBe(201);
    expect(act.body.data.url).toContain('mode=activate');

    const reset = await request(w.app).post(`/api/v1/users/${String(w.chwA._id)}/password-link`).set('Authorization', admin);
    expect(reset.body.data.url).not.toContain('mode=activate');

    // Issuing a new link invalidates the previous one.
    const again = await request(w.app).post(`/api/v1/users/${String(w.chwA._id)}/password-link`).set('Authorization', admin);
    const stale = await request(w.app).post('/api/v1/auth/reset-password').send({ token: tokenFromLink(reset.body.data.url), password: 'some-new-passphrase' });
    expect(stale.status).toBe(400);
    const fresh = await request(w.app).post('/api/v1/auth/reset-password').send({ token: tokenFromLink(again.body.data.url), password: 'some-new-passphrase' });
    expect(fresh.status).toBe(200);
  });

  it('refuses to reactivate a user who never activated', async () => {
    const admin = await w.as(w.progA);
    const pending = await createUser('chw', { organisationId: w.orgA._id, communityIds: [w.comA._id] }, null);
    const res = await request(w.app).post(`/api/v1/users/${String(pending._id)}/status`).set('Authorization', admin).send({ status: 'active', version: 0 });
    expect(res.status).toBe(409);
  });
});
