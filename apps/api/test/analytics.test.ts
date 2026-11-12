import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { csvCell, median, rate } from '../src/modules/analytics/report.service.js';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { ChwProfileModel } from '../src/modules/chws/chw.model.js';
import type { UserDoc } from '../src/modules/users/user.model.js';
import { buildTestApp, createCommunity, createFacility, createOrganisation, createUser, signIn, useTestDatabase } from './support.js';

useTestDatabase();

const DAY = 86_400_000;
const plusDays = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

async function world() {
  const { app } = buildTestApp();
  const orgA = await createOrganisation('ORGA');
  const orgB = await createOrganisation('ORGB');
  const facA = await createFacility(orgA._id, 'FA');
  const facA2 = await createFacility(orgA._id, 'FB');
  const comA = await createCommunity(orgA._id, 'Gwale');
  const comA2 = await createCommunity(orgA._id, 'Kurna');
  const platform = await createUser('platform_admin');
  const progA = await createUser('programme_admin', { organisationId: orgA._id });
  const progB = await createUser('programme_admin', { organisationId: orgB._id });
  const facAdmin = await createUser('facility_admin', { organisationId: orgA._id, facilityId: facA._id });
  const workerA = await createUser('facility_worker', { organisationId: orgA._id, facilityId: facA._id });
  const chwA = await createUser('chw', { organisationId: orgA._id, communityIds: [comA._id, comA2._id], fullName: 'Hauwa CHW' });
  await ChwProfileModel.create({ userId: chwA._id, organisationId: orgA._id, canIssueReferrals: true });
  const bearers = new Map<UserDoc, string>();
  const call = async (u: UserDoc, method: 'get' | 'post' | 'patch', path: string, body?: object) => {
    if (!bearers.has(u)) bearers.set(u, (await signIn(app, u)).bearer);
    const r = request(app)[method](`/api/v1${path}`).set('Authorization', bearers.get(u)!);
    return body ? r.send(body) : r;
  };
  const register = async (name: string, communityId = comA._id) =>
    (
      await call(chwA, 'post', '/patients', {
        fullName: name, sex: 'female', estimatedAge: 25, communityId: String(communityId), carePathway: 'antenatal', pathwayDetails: { expectedDeliveryDate: plusDays(90) }, confirmNotDuplicate: true,
        consent: { purposes: { care_coordination: true, sms: false, voice: false, facility_sharing: true }, method: 'verbal', consentTextVersion: 'v1', language: 'ha' },
      })
    ).body.data.patient as { id: string };

  // Three patients (two in Gwale, one in Kurna); three referrals to facility A, one to B.
  const p1 = await register('Aisha Musa');
  const p2 = await register('Zainab Bello');
  const p3 = await register('Maryam Sani', comA2._id);
  const refer = async (pid: string, fac = facA._id) => (await call(chwA, 'post', '/referrals', { patientId: pid, toFacilityId: String(fac), reason: 'Review' })).body.data.referral ?? (await call(chwA, 'get', `/referrals?patientId=${pid}`)).body.data[0];
  const r1 = await refer(p1.id);
  const r2 = await refer(p2.id);
  await refer(p3.id);
  await refer(p3.id, facA2._id);
  const path = (r: { id: string }) => `/referrals/${r.id}/status`;
  await call(workerA, 'patch', path(r1), { toStatus: 'patient_arrived', version: 0 });
  await call(workerA, 'patch', path(r1), { toStatus: 'service_recorded', serviceSummary: 'Seen', version: 1 });
  await call(workerA, 'patch', path(r1), { toStatus: 'completed', version: 2 });
  await call(chwA, 'patch', path(r2), { toStatus: 'cancelled', note: 'Moved away', version: 0 });

  // Appointments: one attended and one missed today at A, one upcoming at B.
  const book = async (pid: string, fac: string, date: string) => (await call(chwA, 'post', '/appointments', { patientId: pid, facilityId: fac, category: 'antenatal', scheduledFor: date })).body.data;
  const a1 = await book(p1.id, String(facA._id), plusDays(0));
  const a2 = await book(p2.id, String(facA._id), plusDays(0));
  await book(p3.id, String(facA2._id), plusDays(5));
  await call(workerA, 'post', `/appointments/${a1.id}/attendance`, { outcome: 'attended', version: 0 });
  await call(workerA, 'post', `/appointments/${a2.id}/attendance`, { outcome: 'missed', version: 0 });
  await call(chwA, 'post', '/visits', { patientId: p1.id, visitDate: plusDays(0), outcome: 'met', followUpRequired: false });

  return { app, orgA, orgB, facA, facA2, comA, comA2, platform, progA, progB, facAdmin, chwA, call };
}

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  w = await world();
});

const byKey = (rows: Record<string, unknown>[], key: string, value: string) => rows.find((r) => r[key] === value)!;

describe('reports', () => {
  it('counts referrals by facility, with rates that ignore cancellations', async () => {
    const res = await w.call(w.progA, 'get', '/analytics/report?report=referrals');
    expect(res.status).toBe(200);
    const a = byKey(res.body.data.rows, 'facility', 'PHC FA');
    expect(a).toMatchObject({ issued: 3, arrived: 1, completed: 1, cancelled: 1, arrivalRate: 50 });
    expect(byKey(res.body.data.rows, 'facility', 'PHC FB')).toMatchObject({ issued: 1, arrived: 0 });
    expect(res.body.data.totals).toMatchObject({ facility: 'Total', issued: 4, cancelled: 1, arrivalRate: 33.3 });
    // Aggregates only: no patient names anywhere in the report.
    expect(JSON.stringify(res.body)).not.toMatch(/Aisha|Zainab|Maryam/);
  });

  it('reports appointments, communities, health workers, follow-ups and the monthly trend', async () => {
    const appts = (await w.call(w.progA, 'get', `/analytics/report?report=appointments&to=${plusDays(10)}`)).body.data;
    expect(byKey(appts.rows, 'facility', 'PHC FA')).toMatchObject({ booked: 2, attended: 1, missed: 1, attendanceRate: 50 });
    expect(byKey(appts.rows, 'facility', 'PHC FB')).toMatchObject({ booked: 1, upcoming: 1 });

    const coms = (await w.call(w.progA, 'get', '/analytics/report?report=communities')).body.data;
    expect(byKey(coms.rows, 'community', 'Gwale (Dala)')).toMatchObject({ registered: 2, activePatients: 2, referralsIssued: 2, referralsCompleted: 1, followUpsCreated: 1 });
    expect(byKey(coms.rows, 'community', 'Kurna (Dala)')).toMatchObject({ registered: 1, referralsIssued: 2, followUpsCreated: 0 });

    const chws = (await w.call(w.progA, 'get', '/analytics/report?report=chws')).body.data;
    expect(chws.rows[0]).toMatchObject({ chw: 'Hauwa CHW', registered: 3, caseload: 3, visits: 1, referralsIssued: 4 });

    const fu = (await w.call(w.progA, 'get', '/analytics/report?report=followups')).body.data;
    expect(byKey(fu.rows, 'reason', 'Missed appointment')).toMatchObject({ created: 1, open: 1 });

    const monthly = (await w.call(w.progA, 'get', `/analytics/report?report=monthly&from=${plusDays(-40)}`)).body.data;
    expect(monthly.rows.length).toBeGreaterThanOrEqual(2);
    expect(monthly.totals).toMatchObject({ registrations: 3, referralsIssued: 4, referralsCompleted: 1, appointmentsAttended: 1, appointmentsMissed: 1, attendanceRate: 50, visits: 1 });
  });

  it('filters by community and period', async () => {
    const gwale = (await w.call(w.progA, 'get', `/analytics/report?report=referrals&communityId=${w.comA._id}`)).body.data;
    expect(gwale.totals.issued).toBe(2);
    const old = (await w.call(w.progA, 'get', `/analytics/report?report=referrals&from=${plusDays(-60)}&to=${plusDays(-30)}`)).body.data;
    expect(old.rows).toEqual([]);
    expect(old.totals).toBeNull();
    expect((await w.call(w.progA, 'get', `/analytics/report?report=referrals&from=${plusDays(0)}&to=${plusDays(-1)}`)).status).toBe(400);
    expect((await w.call(w.progA, 'get', `/analytics/report?report=referrals&from=2020-01-01&to=2023-01-01`)).status).toBe(400);
  });

  it('keeps each organisation and facility to its own data', async () => {
    expect((await w.call(w.progB, 'get', '/analytics/report?report=referrals')).body.data.rows).toEqual([]);
    expect((await w.call(w.progB, 'get', `/analytics/report?report=referrals&organisationId=${w.orgA._id}`)).status).toBe(403);
    expect((await w.call(w.progB, 'get', `/analytics/report?report=referrals&facilityId=${w.facA._id}`)).status).toBe(404);
    expect((await w.call(w.platform, 'get', '/analytics/report?report=referrals')).status).toBe(400); // must pick an organisation
    expect((await w.call(w.platform, 'get', `/analytics/report?report=referrals&organisationId=${w.orgA._id}`)).body.data.totals.issued).toBe(4);

    // Facility admins: only facility reports, only their facility, whatever they ask for.
    const fac = (await w.call(w.facAdmin, 'get', `/analytics/report?report=referrals&facilityId=${w.facA2._id}`)).body.data;
    expect(fac.rows.map((r: { facility: string }) => r.facility)).toEqual(['PHC FA']);
    expect((await w.call(w.facAdmin, 'get', '/analytics/report?report=chws')).status).toBe(403);
    expect((await w.call(w.chwA, 'get', '/analytics/report?report=referrals')).status).toBe(403);
  });

  it('exports CSV safely and audits the download', async () => {
    const res = await w.call(w.progA, 'get', '/analytics/report?report=referrals&format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="caretrail-referrals-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('Receiving facility,Issued,Arrived,Completed,Cancelled,Expired,"Still awaited, overdue",Arrival rate (%),Median days to arrival (days)');
    expect(lines.at(-1)).toMatch(/^Total,4,1,1,1,0,/);
    const audit = await AuditLogModel.findOne({ action: 'analytics.export' }).lean();
    expect(audit?.metadata).toMatchObject({ report: 'referrals' });
  });
});

describe('report helpers', () => {
  it('neutralises spreadsheet formulas and quotes special characters', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+234')).toBe("'+234");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('Kano, Dala')).toBe('"Kano, Dala"');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(null)).toBe('');
  });
  it('computes rates and medians', () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(1, 0)).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
