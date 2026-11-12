import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { ChwProfileModel } from '../src/modules/chws/chw.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { TransientProviderError, type NotificationProvider, type OutgoingMessage } from '../src/modules/notifications/providers.js';
import { PatientModel } from '../src/modules/patients/patient.model.js';
import type { UserDoc } from '../src/modules/users/user.model.js';
import { buildTestApp, createCommunity, createFacility, createOrganisation, createUser, signIn, useTestDatabase } from './support.js';

useTestDatabase();

const DAY = 86_400_000;
const plusDays = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
// Smallest valid-looking files for the magic-byte check.
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 1)]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64, 1)]);

/** Records what would have been sent; can be told to fail. */
class CapturingProvider implements NotificationProvider {
  readonly name = 'capture';
  sent: OutgoingMessage[] = [];
  failNext: 'transient' | 'permanent' | null = null;
  async send(m: OutgoingMessage) {
    if (this.failNext === 'transient') throw new TransientProviderError('Gateway timeout for +2348031234567');
    if (this.failNext === 'permanent') throw new Error('Rejected');
    this.sent.push(m);
    return { providerMessageId: `cap-${this.sent.length}` };
  }
}

async function world() {
  const sms = new CapturingProvider();
  const { app, clock } = buildTestApp({ notificationProviders: { sms, voice: null, push: null } });
  const orgA = await createOrganisation('ORGA');
  const orgB = await createOrganisation('ORGB');
  const facA = await createFacility(orgA._id, 'FA');
  const comA = await createCommunity(orgA._id, 'Gwale');
  const platform = await createUser('platform_admin');
  const progA = await createUser('programme_admin', { organisationId: orgA._id });
  const progB = await createUser('programme_admin', { organisationId: orgB._id });
  const workerA = await createUser('facility_worker', { organisationId: orgA._id, facilityId: facA._id });
  const chwA = await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id] });
  await ChwProfileModel.create({ userId: chwA._id, organisationId: orgA._id, canIssueReferrals: true, supervisorUserId: workerA._id });
  const bearers = new Map<UserDoc, string>();
  const call = async (u: UserDoc, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, body?: object) => {
    if (!bearers.has(u)) bearers.set(u, (await signIn(app, u)).bearer);
    const r = request(app)[method](`/api/v1${path}`).set('Authorization', bearers.get(u)!);
    return body ? r.send(body) : r;
  };
  const upload = async (u: UserDoc, path: string, body: Buffer, type: string) => {
    if (!bearers.has(u)) bearers.set(u, (await signIn(app, u)).bearer);
    return request(app).put(`/api/v1${path}`).set('Authorization', bearers.get(u)!).set('Content-Type', type).send(body);
  };
  const register = async (name: string, consent: { sms: boolean }, channel: 'sms' | 'none' = 'sms') => {
    const res = await call(chwA, 'post', '/patients', {
      fullName: name, sex: 'female', estimatedAge: 25, communityId: String(comA._id), carePathway: 'antenatal', phone: '08031234567', phoneOwner: 'self',
      pathwayDetails: { expectedDeliveryDate: plusDays(90) }, confirmNotDuplicate: true, preferredChannel: channel, preferredLanguage: 'ha',
      consent: { purposes: { care_coordination: true, sms: consent.sms, voice: false, facility_sharing: true }, method: 'verbal', consentTextVersion: 'v1', language: 'ha' },
    });
    expect(res.status).toBe(201);
    return res.body.data.patient as { id: string; patientCode: string };
  };
  return { app, clock, sms, orgA, orgB, facA, platform, progA, progB, workerA, chwA, call, upload, register };
}

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  w = await world();
});

const draft = { category: 'antenatal_care', title: 'Attending antenatal visits', body: 'Programme-written text used only in tests.' };

describe('education content', () => {
  it('requires clinical approval before anything reaches CHWs', async () => {
    const created = await w.call(w.progA, 'post', '/education', draft);
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data).toMatchObject({ status: 'draft', approval: null, audio: { en: null, ha: null } });

    // Not visible to CHWs; programme admins cannot approve their own content; no skipping steps.
    expect((await w.call(w.chwA, 'get', `/education/${id}`)).status).toBe(404);
    expect((await w.call(w.progA, 'post', `/education/${id}/transition`, { action: 'publish', version: 0 })).status).toBe(422);
    expect((await w.call(w.progA, 'post', `/education/${id}/transition`, { action: 'submit', version: 0 })).body.data.status).toBe('in_review');
    expect((await w.call(w.progA, 'post', `/education/${id}/transition`, { action: 'approve', version: 1, reviewerName: 'X', reviewerCredentials: 'Y', approvedOn: plusDays(0) })).status).toBe(403);

    // Reviewer returns it with a note, author resubmits, reviewer approves with a named clinician.
    expect((await w.call(w.platform, 'post', `/education/${id}/transition`, { action: 'return', version: 1 })).status).toBe(400);
    const returned = await w.call(w.platform, 'post', `/education/${id}/transition`, { action: 'return', version: 1, note: 'Simplify the wording' });
    expect(returned.body.data).toMatchObject({ status: 'draft', reviewNote: 'Simplify the wording' });
    await w.call(w.progA, 'post', `/education/${id}/transition`, { action: 'submit', version: 2 });
    const approved = await w.call(w.platform, 'post', `/education/${id}/transition`, { action: 'approve', version: 3, reviewerName: 'Dr. Reviewer', reviewerCredentials: 'Obstetrician', approvedOn: plusDays(0) });
    expect(approved.body.data).toMatchObject({ status: 'approved', approval: { reviewerName: 'Dr. Reviewer' } });
    expect((await w.call(w.chwA, 'get', `/education/${id}`)).status).toBe(404);

    const published = await w.call(w.progA, 'post', `/education/${id}/transition`, { action: 'publish', version: 4 });
    expect(published.body.data.status).toBe('published');
    expect((await w.call(w.chwA, 'get', `/education/${id}`)).body.data.title).toBe(draft.title);
    expect((await w.call(w.chwA, 'post', '/education', draft)).status).toBe(403);

    // Editing published text takes it off CHWs' phones until it is reviewed again.
    const edited = await w.call(w.progA, 'patch', `/education/${id}`, { body: 'Changed wording that has not been reviewed.', version: 5 });
    expect(edited.body.data).toMatchObject({ status: 'draft', approval: null, publishedAt: null });
    expect((await w.call(w.chwA, 'get', '/education')).body.data).toEqual([]);

    // Other organisations never see it.
    expect((await w.call(w.progB, 'get', `/education/${id}`)).status).toBe(404);
    const actions = (await AuditLogModel.find({ entityType: 'education' }).lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['education.create', 'education.submit', 'education.return', 'education.approve', 'education.publish', 'education.update']));
  });

  it('requires both Hausa fields together', async () => {
    expect((await w.call(w.progA, 'post', '/education', { ...draft, titleHa: 'Take' })).status).toBe(400);
    const ok = await w.call(w.progA, 'post', '/education', { ...draft, titleHa: 'Take', bodyHa: 'Rubutun gwaji kawai.' });
    expect(ok.status).toBe(201);
    expect((await w.call(w.progA, 'patch', `/education/${ok.body.data.id}`, { bodyHa: null, version: 0 })).status).toBe(400);
  });

  it('stores audio through the storage layer and checks type, content and size', async () => {
    const id = (await w.call(w.progA, 'post', '/education', draft)).body.data.id as string;
    expect((await w.upload(w.progA, `/education/${id}/audio/en?version=0`, Buffer.from('not audio at all'), 'audio/mpeg')).status).toBe(400);
    expect((await w.upload(w.progA, `/education/${id}/audio/en?version=0`, MP3, 'application/pdf')).status).toBe(400);
    expect((await w.upload(w.progA, `/education/${id}/audio/en?version=0`, Buffer.alloc(10 * 1024 * 1024 + 10, 0), 'audio/mpeg')).status).toBe(413);
    expect((await w.upload(w.progA, `/education/${id}/audio/ha?version=0`, OGG, 'audio/ogg')).status).toBe(400); // no Hausa text yet
    expect((await w.upload(w.chwA, `/education/${id}/audio/en?version=0`, MP3, 'audio/mpeg')).status).toBe(403);

    const up = await w.upload(w.progA, `/education/${id}/audio/en?version=0`, MP3, 'audio/mpeg');
    expect(up.status).toBe(200);
    expect(up.body.data.audio.en).toMatchObject({ contentType: 'audio/mpeg', size: MP3.length });
    const got = await w.call(w.progA, 'get', `/education/${id}/audio/en`);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('audio/mpeg');
    expect(Buffer.compare(got.body as Buffer, MP3)).toBe(0);

    // Replacing the file keeps one object; deleting removes it.
    const replaced = await w.upload(w.progA, `/education/${id}/audio/en?version=1`, Buffer.concat([MP3, Buffer.alloc(5, 2)]), 'audio/mpeg');
    expect(replaced.body.data.audio.en.size).toBe(MP3.length + 5);
    expect((await w.upload(w.progA, `/education/${id}/audio/en?version=1`, MP3, 'audio/mpeg')).status).toBe(409); // stale version
    expect((await w.call(w.progA, 'delete', `/education/${id}/audio/en?version=2`)).body.data.audio.en).toBeNull();
    expect((await w.call(w.progA, 'get', `/education/${id}/audio/en`)).status).toBe(404);
  });
});

describe('notifications', () => {
  it('sends reminders only with consent and a provider, without medical details or logging the number', async () => {
    const p = await w.register('Aisha Musa', { sms: true });
    const appt = (await w.call(w.chwA, 'post', '/appointments', { patientId: p.id, facilityId: String(w.facA._id), category: 'antenatal', scheduledFor: plusDays(3) })).body.data;
    const res = await w.call(w.progA, 'post', '/notifications/send', { appointmentId: appt.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ channel: 'sms', templateKey: 'appointment_reminder', language: 'ha', recipient: { type: 'patient', label: p.patientCode } });
    expect(JSON.stringify(res.body)).not.toContain('8031234567');

    const run = await w.call(w.progA, 'post', '/notifications/dispatch/run');
    expect(run.body.data.sent).toBeGreaterThanOrEqual(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(w.sms.sent).toHaveLength(1);
    expect(w.sms.sent[0]).toMatchObject({ to: '+2348031234567', language: 'ha' });
    expect(w.sms.sent[0]!.text).toContain('PHC FA');
    expect(w.sms.sent[0]!.text).not.toMatch(/antenatal|Aisha/i);
    // At most one manual reminder per record per day.
    expect((await w.call(w.progA, 'post', '/notifications/send', { appointmentId: appt.id })).status).toBe(409);
    // CHWs and facility staff cannot send.
    expect((await w.call(w.chwA, 'post', '/notifications/send', { appointmentId: appt.id })).status).toBe(403);

    // Withdrawn consent stops messages that are already queued.
    const q = await w.register('Zainab Bello', { sms: true });
    // Queued for tomorrow while consent was still given…
    await NotificationModel.create({ organisationId: w.orgA._id, recipient: { type: 'patient', id: q.id }, channel: 'sms', templateKey: 'appointment_reminder', params: { facility: 'PHC FA', date: '01/01/2027' }, language: 'ha', status: 'queued', scheduledFor: new Date(Date.now() + DAY) });
    // …then withdrawn before it was due.
    await PatientModel.updateOne({ _id: q.id }, { $set: { 'consent.sms.granted': false } });
    w.clock.advance(2 * DAY);
    await w.call(w.progA, 'post', '/notifications/dispatch/run');
    const blocked = await NotificationModel.findOne({ 'recipient.id': q.id }).lean();
    expect(blocked).toMatchObject({ status: 'blocked_no_consent', lastError: 'No consent for SMS' });
    expect(w.sms.sent).toHaveLength(1);

    const history = await w.call(w.progA, 'get', '/notifications/history');
    expect(history.body.data.map((n: { status: string }) => n.status).sort()).toEqual(['blocked_no_consent', 'sent']);
    expect(JSON.stringify(history.body)).not.toContain('8031234567');
    expect((await w.call(w.progB, 'get', '/notifications/history')).body.data).toEqual([]);
  });

  it('refuses patients without a reminder channel and records missing consent as blocked', async () => {
    const p = await w.register('Aisha Musa', { sms: false }, 'none');
    const appt = (await w.call(w.chwA, 'post', '/appointments', { patientId: p.id, facilityId: String(w.facA._id), category: 'antenatal', scheduledFor: plusDays(3) })).body.data;
    expect((await w.call(w.progA, 'post', '/notifications/send', { appointmentId: appt.id })).status).toBe(409);

    // A channel without consent (e.g. data fixed by hand) is caught when queuing.
    await PatientModel.updateOne({ _id: p.id }, { $set: { preferredChannel: 'sms' } });
    const res = await w.call(w.progA, 'post', '/notifications/send', { appointmentId: appt.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'blocked_no_consent', lastError: 'No consent for SMS' });
    await w.call(w.progA, 'post', '/notifications/dispatch/run');
    expect(w.sms.sent).toHaveLength(0);
  });

  it('retries transient provider failures with backoff and gives up on permanent ones', async () => {
    const p = await w.register('Aisha Musa', { sms: true });
    const appt = (await w.call(w.chwA, 'post', '/appointments', { patientId: p.id, facilityId: String(w.facA._id), category: 'antenatal', scheduledFor: plusDays(3) })).body.data;
    w.sms.failNext = 'transient';
    await w.call(w.progA, 'post', '/notifications/send', { appointmentId: appt.id });
    await w.call(w.progA, 'post', '/notifications/dispatch/run');
    let n = await NotificationModel.findOne({}).lean();
    expect(n).toMatchObject({ status: 'queued', attempts: 1 });
    expect(n!.lastError).not.toContain('8031234567');
    expect(n!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    w.sms.failNext = 'permanent';
    w.clock.advance(5 * 60_000);
    await w.call(w.progA, 'post', '/notifications/dispatch/run');
    n = await NotificationModel.findOne({}).lean();
    expect(n).toMatchObject({ status: 'failed', attempts: 2, lastError: 'Rejected' });
  });

  it('plans day-before appointment reminders once, only when the programme switched them on', async () => {
    const p = await w.register('Aisha Musa', { sms: true });
    await w.call(w.chwA, 'post', '/appointments', { patientId: p.id, facilityId: String(w.facA._id), category: 'antenatal', scheduledFor: plusDays(1) });
    expect((await w.call(w.progA, 'post', '/notifications/dispatch/run')).body.data.remindersPlanned).toBe(0);

    const s = (await w.call(w.progA, 'get', '/settings')).body.data;
    const put = await w.call(w.progA, 'put', '/settings', {
      pilot: s.pilot, referralExpectedArrivalDays: 7, appointmentOverdueGraceDays: 1, offlineSessionGraceDays: 14, appointmentReminders: true, version: s.version,
    });
    expect(put.status).toBe(200);
    expect(put.body.data.appointmentReminders).toBe(true);

    expect((await w.call(w.progA, 'post', '/notifications/dispatch/run')).body.data).toMatchObject({ remindersPlanned: 1, sent: 1 });
    expect((await w.call(w.progA, 'post', '/notifications/dispatch/run')).body.data.remindersPlanned).toBe(0);
    expect(w.sms.sent).toHaveLength(1);
  });

  it('puts new and escalated follow-ups in staff inboxes', async () => {
    const p = await w.register('Aisha Musa', { sms: false }, 'none');
    const task = await w.call(w.progA, 'post', '/follow-ups', { patientId: p.id, dueOn: plusDays(2), note: 'Check in' });
    expect(task.status).toBe(201);

    const inbox = await w.call(w.chwA, 'get', '/notifications/inbox');
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0]).toMatchObject({ templateKey: 'followup_assigned', link: { type: 'follow_up', id: task.body.data.id }, readAt: null });
    expect(inbox.body.data[0].text).toContain(p.patientCode);
    expect(inbox.body.data[0].text).not.toContain('Aisha');
    expect((await w.call(w.chwA, 'get', '/notifications/inbox?lang=ha')).body.data[0].text).toContain('bibiya');

    await w.call(w.chwA, 'post', `/follow-ups/${task.body.data.id}/escalate`, { notes: 'Cannot reach', version: 0 });
    const sup = await w.call(w.workerA, 'get', '/notifications/inbox/count');
    expect(sup.body.data.unread).toBe(1);
    const items = (await w.call(w.workerA, 'get', '/notifications/inbox')).body.data;
    expect(items[0].templateKey).toBe('followup_escalated');

    // Read state is per user; nobody can mark someone else's message.
    expect((await w.call(w.chwA, 'post', `/notifications/inbox/${items[0].id}/read`)).status).toBe(404);
    expect((await w.call(w.workerA, 'post', `/notifications/inbox/${items[0].id}/read`)).status).toBe(204);
    expect((await w.call(w.workerA, 'get', '/notifications/inbox/count')).body.data.unread).toBe(0);
    expect((await w.call(w.chwA, 'post', '/notifications/inbox/read-all')).body.data.updated).toBe(1);
  });
});
