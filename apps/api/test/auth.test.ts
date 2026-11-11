import { SignJWT } from 'jose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { RefreshTokenModel } from '../src/modules/auth/refresh-token.model.js';
import { ROTATION_GRACE_MS } from '../src/modules/auth/session.service.js';
import { UserModel } from '../src/modules/users/user.model.js';
import {
  PASSWORD,
  buildTestApp,
  createFacility,
  createOrganisation,
  createUser,
  login,
  signIn,
  tokenFromLink,
  useTestDatabase,
} from './support.js';

useTestDatabase();

async function programmeAdmin() {
  const org = await createOrganisation('ORGA');
  return createUser('programme_admin', { organisationId: org._id });
}

describe('login', () => {
  it('issues an access token and an httpOnly, SameSite=Strict refresh cookie to web clients', async () => {
    const { app } = buildTestApp();
    const user = await programmeAdmin();
    const res = await login(app, user.email, PASSWORD, 'web');

    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.body.data.user).toMatchObject({ id: String(user._id), role: 'programme_admin' });
    expect(res.body.data.user.permissions).toContain('user:manage');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|failedLoginCount|sessionVersion/);
    expect(res.headers['cache-control']).toBe('no-store');

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^ct_rt=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(user.email);
  });

  it('returns the refresh token in the body for mobile clients and sets no cookie', async () => {
    const { app } = buildTestApp();
    const user = await programmeAdmin();
    const res = await login(app, user.email, PASSWORD, 'mobile');
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('uses one generic error for unknown emails and wrong passwords, and audits without PII', async () => {
    const { app } = buildTestApp();
    const user = await programmeAdmin();
    const unknown = await login(app, 'nobody@example.org', PASSWORD);
    const wrong = await login(app, user.email, 'not-the-password');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);

    const logs = await AuditLogModel.find({ action: 'auth.login', outcome: 'failure' }).lean();
    expect(logs.map((l) => l.metadata?.reason).sort()).toEqual(['bad_password', 'unknown_account']);
    expect(JSON.stringify(logs)).not.toContain('nobody@example.org');
    expect(JSON.stringify(logs)).not.toContain(user.email);
  });

  it('locks the account after repeated failures, then unlocks after the lockout period', async () => {
    const { app, clock } = buildTestApp();
    const user = await programmeAdmin();
    for (let i = 0; i < 5; i++) expect((await login(app, user.email, 'wrong-password')).status).toBe(401);

    expect((await login(app, user.email)).status).toBe(401); // correct password, but locked
    expect(await AuditLogModel.countDocuments({ action: 'auth.lockout' })).toBe(1);

    clock.advance(16 * 60_000);
    expect((await login(app, user.email)).status).toBe(200);
    const fresh = await UserModel.findById(user._id).lean();
    expect(fresh?.failedLoginCount).toBe(0);
  });

  it('rejects pending, inactive and invalid input', async () => {
    const { app } = buildTestApp();
    const pending = await createUser('platform_admin', {}, null);
    const inactive = await createUser('platform_admin', { status: 'inactive' });
    expect((await login(app, pending.email, PASSWORD)).status).toBe(401);
    expect((await login(app, inactive.email)).status).toBe(401);
    const bad = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['email', 'password']);
  });
});

describe('access tokens', () => {
  it('rejects missing, malformed, forged and wrongly-signed tokens', async () => {
    const { app } = buildTestApp();
    const user = await programmeAdmin();
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);

    const forged = await new SignJWT({ role: 'platform_admin', sv: 0, cl: 'web' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(user._id))
      .setIssuer('caretrail-api')
      .setAudience('caretrail')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('some-other-secret-that-is-also-long-enough'));
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });

  it('stops working immediately when the user is deactivated', async () => {
    const { app } = buildTestApp();
    const user = await programmeAdmin();
    const { bearer } = await signIn(app, user);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', bearer)).status).toBe(200);
    await UserModel.updateOne({ _id: user._id }, { $set: { status: 'inactive' } });
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', bearer)).status).toBe(401);
  });
});

describe('refresh token rotation', () => {
  it('rotates on every use and returns a working session', async () => {
    const { app } = buildTestApp();
    const user = await programmeAdmin();
    const { refreshToken } = await signIn(app, user);

    const r1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.data.refreshToken).not.toBe(refreshToken);
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${r1.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('works from the web cookie', async () => {
    const { app } = buildTestApp();
    const user = await programmeAdmin();
    const res = await login(app, user.email, PASSWORD, 'web');
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const r = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(r.body.data.user.id).toBe(String(user._id));
    expect((r.headers['set-cookie'] as unknown as string[])[0]).not.toContain(cookie);
  });

  it('treats a re-sent token within the grace window as a retry (lost response on a bad network)', async () => {
    const { app } = buildTestApp();
    const user = await programmeAdmin();
    const { refreshToken } = await signIn(app, user);

    const first = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    const retry = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);

    // The successor from the lost response is revoked; the retry's successor works.
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: retry.body.data.refreshToken })).status).toBe(200);
    const lost = await RefreshTokenModel.findOne({ revokedReason: 'superseded_retry' }).lean();
    expect(lost).not.toBeNull();
  });

  it('revokes the whole family when a rotated token is reused after the grace window', async () => {
    const { app, clock } = buildTestApp();
    const user = await programmeAdmin();
    const { refreshToken } = await signIn(app, user);
    const r1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });

    clock.advance(ROTATION_GRACE_MS + 1_000);
    const stolen = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(stolen.status).toBe(401);
    // The legitimate holder is signed out too — the family is compromised.
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: r1.body.data.refreshToken })).status).toBe(401);
    expect(await AuditLogModel.countDocuments({ action: 'auth.refresh_reuse' })).toBe(1);
  });

  it('rejects unknown and expired tokens and refreshes for deactivated users', async () => {
    const { app, clock } = buildTestApp();
    const user = await programmeAdmin();
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'x'.repeat(43) })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').send({})).status).toBe(401);

    const a = await signIn(app, user);
    clock.advance(31 * 86_400_000);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken })).status).toBe(401);

    clock.advance(-31 * 86_400_000);
    const b = await signIn(app, user);
    await UserModel.updateOne({ _id: user._id }, { $set: { status: 'inactive' } });
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: b.refreshToken })).status).toBe(401);
  });
});

describe('logout', () => {
  it('revokes this session only, or every session with allDevices', async () => {
    const { app } = buildTestApp();
    const user = await programmeAdmin();
    const phone = await signIn(app, user);
    const laptop = await signIn(app, user);

    expect((await request(app).post('/api/v1/auth/logout').send({ refreshToken: phone.refreshToken })).status).toBe(204);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: phone.refreshToken })).status).toBe(401);
    const laptop2 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: laptop.refreshToken });
    expect(laptop2.status).toBe(200);

    const tablet = await signIn(app, user);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: tablet.refreshToken, allDevices: true });
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: laptop2.body.data.refreshToken })).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', tablet.bearer)).status).toBe(401);
  });
});

describe('password reset', () => {
  it('responds identically for known and unknown emails and only sends for active accounts', async () => {
    const { app, notifier } = buildTestApp();
    const user = await programmeAdmin();
    const known = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const unknown = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.org' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body.data).toEqual(unknown.body.data);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]!.url).toMatch(/^http:\/\/localhost:3000\/reset-password\?token=/);
  });

  it('resets the password once, revokes old sessions and enforces the password policy', async () => {
    const { app, notifier } = buildTestApp();
    const user = await programmeAdmin();
    const old = await signIn(app, user);
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const token = tokenFromLink(notifier.sent[0]!.url);

    const weak = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'short' });
    expect(weak.status).toBe(400);

    const ok = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'a-brand-new-passphrase' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ activated: false });

    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'another-passphrase-1' })).status).toBe(400);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', old.bearer)).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: old.refreshToken })).status).toBe(401);
    expect((await login(app, user.email)).status).toBe(401);
    expect((await login(app, user.email, 'a-brand-new-passphrase')).status).toBe(200);
  });

  it('rejects expired links', async () => {
    const { app, notifier, clock } = buildTestApp();
    const user = await programmeAdmin();
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    clock.advance(61 * 60_000);
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenFromLink(notifier.sent[0]!.url), password: 'a-brand-new-passphrase' });
    expect(res.status).toBe(400);
  });
});

describe('change password', () => {
  it('requires the current password, keeps this device signed in and signs out others', async () => {
    const { app } = buildTestApp();
    const user = await programmeAdmin();
    const here = await signIn(app, user);
    const elsewhere = await signIn(app, user);

    const wrong = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', here.bearer)
      .send({ currentPassword: 'nope-nope-nope', newPassword: 'fresh-passphrase-42' });
    expect(wrong.status).toBe(400);

    const ok = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', here.bearer)
      .send({ currentPassword: PASSWORD, newPassword: 'fresh-passphrase-42' });
    expect(ok.status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${ok.body.data.accessToken}`)).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: elsewhere.refreshToken })).status).toBe(401);
  });
});

describe('facility user without a facility', () => {
  it('is refused at the access-scope layer', async () => {
    const { app } = buildTestApp();
    const org = await createOrganisation('ORGX');
    await createFacility(org._id, 'F1');
    const broken = await createUser('facility_worker', { organisationId: org._id, facilityId: null });
    const { bearer } = await signIn(app, broken);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', bearer)).status).toBe(403);
  });
});
