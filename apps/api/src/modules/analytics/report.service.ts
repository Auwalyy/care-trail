import { Types, type QueryFilter } from 'mongoose';
import { FOLLOW_UP_REASON_LABELS, REPORT_INFO, type FollowUpReason, type FollowUpStatus, type ReportCell, type ReportColumn, type ReportDto, type ReportKey } from '@caretrail/shared-types';
import type { ReportQuery } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { resolveTargetOrganisation } from '../access/access-scope.js';
import { AppointmentModel, type AppointmentDoc } from '../appointments/appointment.model.js';
import type { AuditService } from '../audit/audit.service.js';
import { ChwProfileModel } from '../chws/chw.model.js';
import { CommunityModel } from '../communities/community.model.js';
import { FacilityModel } from '../facilities/facility.model.js';
import { FollowUpTaskModel, type FollowUpTaskDoc } from '../follow-ups/follow-up.model.js';
import { PatientModel, type PatientDoc } from '../patients/patient.model.js';
import { ReferralModel, type ReferralDoc } from '../referrals/referral.model.js';
import { UserModel } from '../users/user.model.js';
import { VisitModel, type VisitDoc } from '../visits/visit.model.js';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const OPEN_TASK: FollowUpStatus[] = ['pending', 'assigned', 'in_progress', 'contacted'];

/** Percentage with one decimal, or null when there is nothing to divide by. */
export const rate = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  return Math.round(v * 10) / 10;
}
const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY;

interface Ctx {
  org: Types.ObjectId;
  from: string;
  to: string;
  start: Date;
  end: Date; // exclusive
  today: string;
  facilityId: Types.ObjectId | null;
  communityId: Types.ObjectId | null;
  /** Patients of the chosen community (null = no community filter). */
  communityPatients: Types.ObjectId[] | null;
}

const col = (key: string, label: string, type: ReportColumn['type'] = 'number', help?: string): ReportColumn => ({ key, label, type, ...(help ? { help } : {}) });

/** Sums the number columns of rows (rates and medians are filled in by each report). */
function sumRows(columns: ReportColumn[], rows: Record<string, ReportCell>[]) {
  const t: Record<string, ReportCell> = {};
  for (const c of columns) if (c.type === 'number') t[c.key] = rows.reduce((s, r) => s + (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0), 0);
  return t;
}

/**
 * Aggregated programme reports. Each report reads only the fields it counts (projected), groups in
 * the API, and returns no personal data. Fine for pilot volumes (tens of thousands of records);
 * move the grouping into MongoDB `$group` pipelines if a deployment grows beyond that (A44).
 */
export class ReportService {
  private readonly now: () => Date;
  constructor(private readonly deps: { audit: AuditService; now?: () => Date }) {
    this.now = deps.now ?? (() => new Date());
  }

  private async context(auth: AuthContext, q: ReportQuery): Promise<Ctx> {
    if (auth.scope.kind === 'facility' && !REPORT_INFO[q.report].facilityStaff) throw AppError.forbidden('This report is for programme staff.');
    const org = await resolveTargetOrganisation(auth.scope, q.organisationId);
    const today = iso(this.now());
    const to = q.to ?? today;
    const from = q.from ?? iso(new Date(Date.parse(to) - 89 * DAY));
    let facilityId = q.facilityId ? new Types.ObjectId(q.facilityId) : null;
    if (auth.scope.kind === 'facility') facilityId = auth.scope.facilityId; // facility staff: always their own
    else if (facilityId && !(await FacilityModel.exists({ _id: facilityId, organisationId: org }))) throw AppError.notFound('Facility');
    const communityId = q.communityId ? new Types.ObjectId(q.communityId) : null;
    if (communityId && !(await CommunityModel.exists({ _id: communityId, organisationId: org }))) throw AppError.notFound('Community');
    const communityPatients = communityId ? (await PatientModel.find({ organisationId: org, communityId }).select('_id').lean()).map((p) => p._id) : null;
    return { org, from, to, start: new Date(`${from}T00:00:00Z`), end: new Date(Date.parse(`${to}T00:00:00Z`) + DAY), today, facilityId, communityId, communityPatients };
  }

  async run(auth: AuthContext, q: ReportQuery): Promise<ReportDto> {
    const c = await this.context(auth, q);
    const build: Record<ReportKey, (c: Ctx) => Promise<Pick<ReportDto, 'columns' | 'rows' | 'totals'>>> = {
      monthly: (x) => this.monthly(x),
      referrals: (x) => this.referrals(x),
      appointments: (x) => this.appointments(x),
      communities: (x) => this.communities(x),
      chws: (x) => this.chws(x),
      followups: (x) => this.followups(x),
    };
    const body = await build[q.report](c);
    return {
      report: q.report,
      title: REPORT_INFO[q.report].title,
      ...body,
      filters: { organisationId: String(c.org), from: c.from, to: c.to, facilityId: c.facilityId ? String(c.facilityId) : null, communityId: c.communityId ? String(c.communityId) : null },
      generatedAt: this.now().toISOString(),
    };
  }

  /** Records a download (report and period only — the file itself holds no personal data). */
  async recordExport(auth: AuthContext, r: ReportDto, ctx: RequestContext) {
    await this.deps.audit.record({ action: 'analytics.export', auth, organisationId: new Types.ObjectId(r.filters.organisationId), metadata: { report: r.report, from: r.filters.from, to: r.filters.to, rows: r.rows.length } }, ctx);
  }

  // ── Reports ───────────────────────────────────────────────────────────────────
  private referralFilter(c: Ctx, dateField: 'issuedAt' | 'completion.at' = 'issuedAt'): QueryFilter<ReferralDoc> {
    return {
      organisationId: c.org,
      [dateField]: { $gte: c.start, $lt: c.end },
      ...(c.facilityId ? { toFacilityId: c.facilityId } : {}),
      ...(c.communityPatients ? { patientId: { $in: c.communityPatients } } : {}),
    } as QueryFilter<ReferralDoc>;
  }

  private appointmentFilter(c: Ctx): QueryFilter<AppointmentDoc> {
    return {
      organisationId: c.org,
      scheduledFor: { $gte: c.from, $lte: c.to },
      ...(c.facilityId ? { facilityId: c.facilityId } : {}),
      ...(c.communityPatients ? { patientId: { $in: c.communityPatients } } : {}),
    } as QueryFilter<AppointmentDoc>;
  }

  private async facilityNames(org: Types.ObjectId) {
    return new Map((await FacilityModel.find({ organisationId: org }).select('name').lean()).map((f) => [String(f._id), f.name]));
  }

  private async referrals(c: Ctx) {
    const docs = await ReferralModel.find(this.referralFilter(c)).select('toFacilityId status issuedAt arrival expectedArrivalBy').lean<ReferralDoc[]>();
    const names = await this.facilityNames(c.org);
    const groups = new Map<string, ReferralDoc[]>();
    for (const d of docs) groups.set(String(d.toFacilityId), [...(groups.get(String(d.toFacilityId)) ?? []), d]);
    const summarise = (list: ReferralDoc[]) => {
      const arrived = list.filter((d) => d.arrival);
      const cancelled = list.filter((d) => d.status === 'cancelled').length;
      return {
        issued: list.length,
        arrived: arrived.length,
        completed: list.filter((d) => d.status === 'completed').length,
        cancelled,
        expired: list.filter((d) => d.status === 'expired').length,
        overdue: list.filter((d) => d.status === 'issued' && d.expectedArrivalBy < c.today).length,
        arrivalRate: rate(arrived.length, list.length - cancelled),
        medianDaysToArrival: median(arrived.map((d) => daysBetween(d.issuedAt, d.arrival!.at))),
      };
    };
    const columns = [
      col('facility', 'Receiving facility', 'text'),
      col('issued', 'Issued'),
      col('arrived', 'Arrived', 'number', 'The facility confirmed the patient arrived'),
      col('completed', 'Completed'),
      col('cancelled', 'Cancelled'),
      col('expired', 'Expired', 'number', 'Not seen by the expected date; a follow-up task was created'),
      col('overdue', 'Still awaited, overdue'),
      col('arrivalRate', 'Arrival rate', 'percent', 'Arrived ÷ (issued − cancelled)'),
      col('medianDaysToArrival', 'Median days to arrival', 'days'),
    ];
    const rows = [...groups].map(([id, list]) => ({ facility: names.get(id) ?? 'Unknown facility', ...summarise(list) })).sort((a, b) => b.issued - a.issued);
    return { columns, rows, totals: rows.length ? { facility: 'Total', ...summarise(docs) } : null };
  }

  private async appointments(c: Ctx) {
    const docs = await AppointmentModel.find(this.appointmentFilter(c)).select('facilityId status scheduledFor').lean<AppointmentDoc[]>();
    const names = await this.facilityNames(c.org);
    const summarise = (list: AppointmentDoc[]) => {
      const attended = list.filter((d) => d.status === 'attended').length;
      const missed = list.filter((d) => d.status === 'missed').length;
      return {
        booked: list.length,
        attended,
        missed,
        cancelled: list.filter((d) => d.status === 'cancelled').length,
        upcoming: list.filter((d) => d.status === 'scheduled' && d.scheduledFor >= c.today).length,
        unrecorded: list.filter((d) => d.status === 'scheduled' && d.scheduledFor < c.today).length,
        attendanceRate: rate(attended, attended + missed),
      };
    };
    const groups = new Map<string, AppointmentDoc[]>();
    for (const d of docs) groups.set(String(d.facilityId), [...(groups.get(String(d.facilityId)) ?? []), d]);
    const columns = [
      col('facility', 'Facility', 'text'),
      col('booked', 'Booked', 'number', 'Appointments dated in the period'),
      col('attended', 'Attended'),
      col('missed', 'Missed'),
      col('cancelled', 'Cancelled'),
      col('upcoming', 'Upcoming'),
      col('unrecorded', 'Past, not yet recorded', 'number', 'Within the grace period before being marked missed'),
      col('attendanceRate', 'Attendance rate', 'percent', 'Attended ÷ (attended + missed)'),
    ];
    const rows = [...groups].map(([id, list]) => ({ facility: names.get(id) ?? 'Unknown facility', ...summarise(list) })).sort((a, b) => b.booked - a.booked);
    return { columns, rows, totals: rows.length ? { facility: 'Total', ...summarise(docs) } : null };
  }

  private async communities(c: Ctx) {
    const communities = await CommunityModel.find({ organisationId: c.org, ...(c.communityId ? { _id: c.communityId } : {}) }).select('name lga status').lean();
    const patients = await PatientModel.find({ organisationId: c.org, deletedAt: null }).select('communityId status createdAt').lean<PatientDoc[]>();
    const communityOf = new Map(patients.map((p) => [String(p._id), String(p.communityId)]));
    const [referrals, tasks] = await Promise.all([
      ReferralModel.find(this.referralFilter(c)).select('patientId status').lean<ReferralDoc[]>(),
      FollowUpTaskModel.find({ organisationId: c.org, $or: [{ createdAt: { $gte: c.start, $lt: c.end } }, { resolvedAt: { $gte: c.start, $lt: c.end } }] }).select('patientId createdAt resolvedAt').lean<FollowUpTaskDoc[]>(),
    ]);
    const inPeriod = (d: Date | null | undefined) => Boolean(d && d >= c.start && d < c.end);
    const rows = communities.map((cm) => {
      const id = String(cm._id);
      const mine = (pid: Types.ObjectId) => communityOf.get(String(pid)) === id;
      const refs = referrals.filter((r) => mine(r.patientId));
      return {
        community: `${cm.name} (${cm.lga})`,
        registered: patients.filter((p) => String(p.communityId) === id && inPeriod(p.createdAt)).length,
        activePatients: patients.filter((p) => String(p.communityId) === id && p.status === 'active').length,
        referralsIssued: refs.length,
        referralsCompleted: refs.filter((r) => r.status === 'completed').length,
        followUpsCreated: tasks.filter((t) => mine(t.patientId) && inPeriod(t.createdAt)).length,
        followUpsResolved: tasks.filter((t) => mine(t.patientId) && inPeriod(t.resolvedAt)).length,
      };
    });
    rows.sort((a, b) => b.activePatients - a.activePatients || a.community.localeCompare(b.community));
    const columns = [
      col('community', 'Community', 'text'),
      col('registered', 'Registered in period'),
      col('activePatients', 'Active patients now'),
      col('referralsIssued', 'Referrals issued'),
      col('referralsCompleted', 'Referrals completed', 'number', 'Of the referrals issued in the period'),
      col('followUpsCreated', 'Follow-ups created'),
      col('followUpsResolved', 'Follow-ups resolved'),
    ];
    return { columns, rows, totals: rows.length ? { community: 'Total', ...sumRows(columns, rows) } : null };
  }

  private async chws(c: Ctx) {
    const chws = await UserModel.find({ organisationId: c.org, role: 'chw', ...(c.communityId ? { communityIds: c.communityId } : {}) }).select('fullName status').lean<{ _id: Types.ObjectId; fullName: string; status: string }[]>();
    const ids = chws.map((u) => u._id);
    const [patients, visits, referrals, tasks, profiles] = await Promise.all([
      PatientModel.find({ organisationId: c.org, deletedAt: null, $or: [{ createdBy: { $in: ids } }, { assignedChwId: { $in: ids } }] }).select('createdBy assignedChwId status createdAt').lean<PatientDoc[]>(),
      VisitModel.find({ organisationId: c.org, chwId: { $in: ids }, visitDate: { $gte: c.from, $lte: c.to } }).select('chwId').lean<VisitDoc[]>(),
      ReferralModel.find({ ...this.referralFilter(c), issuedBy: { $in: ids } }).select('issuedBy').lean<ReferralDoc[]>(),
      FollowUpTaskModel.find({ organisationId: c.org, assignedChwId: { $in: ids }, $or: [{ resolvedAt: { $gte: c.start, $lt: c.end } }, { status: { $in: OPEN_TASK } }] }).select('assignedChwId status dueOn resolvedAt').lean<FollowUpTaskDoc[]>(),
      ChwProfileModel.find({ userId: { $in: ids } }).select('userId device').lean<{ userId: Types.ObjectId; device?: { lastSyncAt?: Date | null; pendingOperations?: number | null } }[]>(),
    ]);
    const profileOf = new Map(profiles.map((p) => [String(p.userId), p.device]));
    const rows = chws.map((u) => {
      const id = String(u._id);
      const device = profileOf.get(id);
      return {
        chw: u.fullName,
        status: u.status === 'active' ? 'Active' : u.status === 'pending_activation' ? 'Not yet activated' : 'Inactive',
        registered: patients.filter((p) => String(p.createdBy) === id && p.createdAt >= c.start && p.createdAt < c.end).length,
        caseload: patients.filter((p) => String(p.assignedChwId) === id && p.status === 'active').length,
        visits: visits.filter((v) => String(v.chwId) === id).length,
        referralsIssued: referrals.filter((r) => String(r.issuedBy) === id).length,
        tasksResolved: tasks.filter((t) => String(t.assignedChwId) === id && t.resolvedAt && t.resolvedAt >= c.start && t.resolvedAt < c.end).length,
        tasksOverdue: tasks.filter((t) => String(t.assignedChwId) === id && OPEN_TASK.includes(t.status) && t.dueOn < c.today).length,
        lastSync: device?.lastSyncAt ? device.lastSyncAt.toISOString() : null,
        unsynced: device?.pendingOperations ?? null,
      };
    });
    rows.sort((a, b) => a.chw.localeCompare(b.chw));
    const columns = [
      col('chw', 'Health worker', 'text'),
      col('status', 'Account', 'text'),
      col('registered', 'Registered in period'),
      col('caseload', 'Active caseload now'),
      col('visits', 'Home visits'),
      col('referralsIssued', 'Referrals issued'),
      col('tasksResolved', 'Follow-ups resolved'),
      col('tasksOverdue', 'Follow-ups overdue now'),
      col('lastSync', 'Last sync', 'datetime'),
      col('unsynced', 'Waiting on phone', 'number', 'Changes on the phone not yet uploaded, as reported at the last sync'),
    ];
    const totals = rows.length ? { chw: 'Total', status: null, ...sumRows(columns, rows), lastSync: null } : null;
    return { columns, rows, totals };
  }

  private async followups(c: Ctx) {
    const docs = await FollowUpTaskModel.find({ organisationId: c.org, createdAt: { $gte: c.start, $lt: c.end }, ...(c.communityPatients ? { patientId: { $in: c.communityPatients } } : {}) })
      .select('reason status attempts.reached escalation createdAt resolvedAt')
      .lean<FollowUpTaskDoc[]>();
    const summarise = (list: FollowUpTaskDoc[]) => {
      const resolved = list.filter((t) => t.status === 'resolved');
      return {
        created: list.length,
        resolved: resolved.length,
        reachedRate: rate(resolved.filter((t) => t.attempts.some((a) => a.reached)).length, resolved.length),
        escalated: list.filter((t) => t.escalation).length,
        open: list.filter((t) => t.status !== 'resolved').length,
        medianDaysToResolve: median(resolved.filter((t) => t.resolvedAt).map((t) => daysBetween(t.createdAt, t.resolvedAt!))),
      };
    };
    const groups = new Map<FollowUpReason, FollowUpTaskDoc[]>();
    for (const d of docs) groups.set(d.reason, [...(groups.get(d.reason) ?? []), d]);
    const columns = [
      col('reason', 'Reason', 'text'),
      col('created', 'Created'),
      col('resolved', 'Resolved'),
      col('reachedRate', 'Patient reached', 'percent', 'Resolved tasks with at least one successful contact'),
      col('escalated', 'Escalated'),
      col('open', 'Still open'),
      col('medianDaysToResolve', 'Median days to resolve', 'days'),
    ];
    const rows = [...groups].map(([reason, list]) => ({ reason: FOLLOW_UP_REASON_LABELS[reason], ...summarise(list) })).sort((a, b) => b.created - a.created);
    return { columns, rows, totals: rows.length ? { reason: 'Total', ...summarise(docs) } : null };
  }

  private async monthly(c: Ctx) {
    const months: string[] = [];
    for (let d = new Date(`${c.from.slice(0, 7)}-01T00:00:00Z`); d < c.end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(iso(d).slice(0, 7));
    const patientScope = c.communityId ? { communityId: c.communityId } : {};
    const [patients, issued, completed, appts, tasks, visits] = await Promise.all([
      PatientModel.find({ organisationId: c.org, deletedAt: null, createdAt: { $gte: c.start, $lt: c.end }, ...patientScope }).select('createdAt').lean<PatientDoc[]>(),
      ReferralModel.find(this.referralFilter(c)).select('issuedAt').lean<ReferralDoc[]>(),
      ReferralModel.find(this.referralFilter(c, 'completion.at')).select('completion').lean<ReferralDoc[]>(),
      AppointmentModel.find(this.appointmentFilter(c)).select('status scheduledFor').lean<AppointmentDoc[]>(),
      FollowUpTaskModel.find({ organisationId: c.org, resolvedAt: { $gte: c.start, $lt: c.end }, ...(c.communityPatients ? { patientId: { $in: c.communityPatients } } : {}) }).select('resolvedAt').lean<FollowUpTaskDoc[]>(),
      VisitModel.find({ organisationId: c.org, visitDate: { $gte: c.from, $lte: c.to }, ...(c.communityPatients ? { patientId: { $in: c.communityPatients } } : {}) }).select('visitDate').lean<VisitDoc[]>(),
    ]);
    const month = (d: Date | string) => (typeof d === 'string' ? d : iso(d)).slice(0, 7);
    const count = <T>(list: T[], key: (x: T) => string, m: string) => list.filter((x) => key(x) === m).length;
    const rows = months.map((m) => {
      const attended = count(appts.filter((a) => a.status === 'attended'), (a) => month(a.scheduledFor), m);
      const missed = count(appts.filter((a) => a.status === 'missed'), (a) => month(a.scheduledFor), m);
      return {
        month: m,
        registrations: count(patients, (p) => month(p.createdAt), m),
        visits: count(visits, (v) => month(v.visitDate), m),
        referralsIssued: count(issued, (r) => month(r.issuedAt), m),
        referralsCompleted: count(completed, (r) => month(r.completion!.at), m),
        appointmentsAttended: attended,
        appointmentsMissed: missed,
        attendanceRate: rate(attended, attended + missed),
        followUpsResolved: count(tasks, (t) => month(t.resolvedAt!), m),
      };
    });
    const columns = [
      col('month', 'Month', 'text'),
      col('registrations', 'Registrations'),
      col('visits', 'Home visits'),
      col('referralsIssued', 'Referrals issued'),
      col('referralsCompleted', 'Referrals completed'),
      col('appointmentsAttended', 'Appointments attended'),
      col('appointmentsMissed', 'Appointments missed'),
      col('attendanceRate', 'Attendance rate', 'percent'),
      col('followUpsResolved', 'Follow-ups resolved'),
    ];
    const totals: Record<string, ReportCell> = { month: 'Total', ...sumRows(columns, rows) };
    totals.attendanceRate = rate(totals.appointmentsAttended as number, (totals.appointmentsAttended as number) + (totals.appointmentsMissed as number));
    return { columns, rows, totals };
  }
}

// ── CSV ─────────────────────────────────────────────────────────────────────────
/** Quotes when needed and neutralises spreadsheet formulas (CSV injection). */
export function csvCell(v: ReportCell): string {
  if (v === null) return '';
  if (typeof v === 'number') return String(v);
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 with BOM so Excel opens Hausa names correctly; CRLF line endings. */
export function toCsv(r: ReportDto): string {
  const header = r.columns.map((c) => csvCell(c.type === 'percent' ? `${c.label} (%)` : c.type === 'days' ? `${c.label} (days)` : c.label));
  const lines = [header.join(',')];
  for (const row of [...r.rows, ...(r.totals ? [r.totals] : [])]) lines.push(r.columns.map((c) => csvCell(row[c.key] ?? null)).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
