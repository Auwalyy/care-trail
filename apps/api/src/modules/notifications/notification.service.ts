import { Types, type QueryFilter } from 'mongoose';
import { renderNotification, type DispatchRunResult, type InboxItemDto, type Language, type NotificationDto, type NotificationLink, type NotificationTemplateKey } from '@caretrail/shared-types';
import type { InboxQuery, NotificationHistoryQuery, SendReminderInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import type { Logger } from '../../utils/logger.js';
import { findPaged } from '../../utils/paging.js';
import { organisationFilter, withinScope } from '../access/access-scope.js';
import { AppointmentModel, type AppointmentDoc } from '../appointments/appointment.model.js';
import { appointmentScopeFilter } from '../appointments/appointment.service.js';
import type { AuditService } from '../audit/audit.service.js';
import { FacilityModel } from '../facilities/facility.model.js';
import { PatientModel, type PatientDoc } from '../patients/patient.model.js';
import { ReferralModel, type ReferralDoc } from '../referrals/referral.model.js';
import { referralScopeFilter } from '../referrals/referral.service.js';
import { ProgrammeSettingsModel } from '../settings/settings.model.js';
import { UserModel } from '../users/user.model.js';
import { NotificationModel, type NotificationDoc } from './notification.model.js';
import { TransientProviderError, type ProviderSet } from './providers.js';

const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MS = 10 * 60_000;
const BATCH = 100;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Dates in messages as DD/MM/YYYY, the usual format in Nigeria. */
const displayDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Provider errors can echo the number back; never store it. */
const safeError = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\+?\d[\d\s-]{6,}\d/g, '[number]').slice(0, 200);

/** Why a patient message may not be sent, or null if it may. Checked when queued AND when sent. */
function blockedReason(p: Pick<PatientDoc, 'status' | 'phone' | 'consent'> | null, channel: 'sms' | 'voice'): string | null {
  if (!p) return 'Patient not found';
  if (p.status !== 'active') return 'Patient is not active';
  if (!p.phone) return 'No phone number';
  if (!p.consent?.[channel]?.granted) return `No consent for ${channel === 'sms' ? 'SMS' : 'voice calls'}`;
  return null;
}

import { isDuplicateKey } from './notify-users.js';

export class NotificationService {
  private readonly now: () => Date;
  private running: Promise<DispatchRunResult> | null = null;

  constructor(private readonly deps: { providers: ProviderSet; audit: AuditService; logger: Logger; now?: () => Date }) {
    this.now = deps.now ?? (() => new Date());
  }

  // ── Inbox (every signed-in user) ──────────────────────────────────────────────
  private inboxFilter(auth: AuthContext): QueryFilter<NotificationDoc> {
    return { 'recipient.type': 'user', 'recipient.id': auth.userId, channel: 'in_app' };
  }

  async inbox(auth: AuthContext, query: InboxQuery, lang: Language) {
    const filter: QueryFilter<NotificationDoc> = { ...this.inboxFilter(auth), ...(query.unread ? { readAt: null } : {}) };
    const { items, total } = await findPaged(NotificationModel, filter, { ...query, sort: { createdAt: -1 } });
    return { items: items.map((d) => this.inboxDto(d, lang)), total };
  }

  inboxDto(d: NotificationDoc, lang: Language): InboxItemDto {
    return { id: String(d._id), templateKey: d.templateKey, text: renderNotification(d.templateKey, lang, d.params ?? {}), params: d.params ?? {}, link: d.link ?? null, createdAt: d.createdAt.toISOString(), readAt: d.readAt?.toISOString() ?? null };
  }

  async unreadCount(auth: AuthContext) {
    return { unread: await NotificationModel.countDocuments({ ...this.inboxFilter(auth), readAt: null }) };
  }

  async markRead(auth: AuthContext, id: string) {
    const mine = withinScope<NotificationDoc>({ _id: new Types.ObjectId(id) }, this.inboxFilter(auth));
    // Keep the first read time; repeating the call is harmless.
    const res = await NotificationModel.updateOne(withinScope<NotificationDoc>(mine, { readAt: null }), { $set: { readAt: this.now() } });
    if (!res.matchedCount && !(await NotificationModel.exists(mine))) throw AppError.notFound('Notification');
  }

  async markAllRead(auth: AuthContext) {
    const res = await NotificationModel.updateMany({ ...this.inboxFilter(auth), readAt: null }, { $set: { readAt: this.now() } });
    return { updated: res.modifiedCount };
  }

  // ── Delivery history (programme staff) ────────────────────────────────────────
  async history(auth: AuthContext, query: NotificationHistoryQuery) {
    const filter: QueryFilter<NotificationDoc> = { ...organisationFilter(auth.scope, query.organisationId), channel: { $ne: 'in_app' } };
    if (query.channel) filter.channel = query.channel;
    if (query.status) filter.status = query.status;
    if (query.templateKey) filter.templateKey = query.templateKey as NotificationTemplateKey;
    if (query.patientId) Object.assign(filter, { 'recipient.type': 'patient', 'recipient.id': new Types.ObjectId(query.patientId) });
    const { items, total } = await findPaged(NotificationModel, filter, { ...query, sort: { createdAt: -1 } });
    return { items: await this.historyDtos(items), total };
  }

  private async historyDtos(docs: NotificationDoc[]): Promise<NotificationDto[]> {
    const patientIds = docs.filter((d) => d.recipient.type === 'patient').map((d) => d.recipient.id);
    const userIds = [...docs.filter((d) => d.recipient.type === 'user').map((d) => d.recipient.id), ...docs.flatMap((d) => (d.createdBy ? [d.createdBy] : []))];
    const [patients, users] = await Promise.all([
      PatientModel.find({ _id: { $in: patientIds } }).select('patientCode').lean<{ _id: Types.ObjectId; patientCode: string }[]>(),
      UserModel.find({ _id: { $in: userIds } }).select('fullName').lean<{ _id: Types.ObjectId; fullName: string }[]>(),
    ]);
    const pCodes = new Map(patients.map((p) => [String(p._id), p.patientCode]));
    const uNames = new Map(users.map((u) => [String(u._id), u.fullName]));
    return docs.map((d) => ({
      id: String(d._id),
      organisationId: String(d.organisationId),
      channel: d.channel,
      templateKey: d.templateKey,
      language: d.language,
      recipient: { type: d.recipient.type, id: String(d.recipient.id), label: (d.recipient.type === 'patient' ? pCodes : uNames).get(String(d.recipient.id)) ?? null },
      status: d.status,
      attempts: d.attempts,
      lastError: d.lastError ?? null,
      scheduledFor: d.scheduledFor.toISOString(),
      sentAt: d.sentAt?.toISOString() ?? null,
      createdBy: d.createdBy ? { id: String(d.createdBy), name: uNames.get(String(d.createdBy)) ?? null } : null,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  // ── Patient messages ──────────────────────────────────────────────────────────
  /** Queues a message on the patient's preferred channel. Recorded as blocked if consent is missing. */
  private async queueForPatient(
    patient: PatientDoc,
    n: { templateKey: NotificationTemplateKey; params: Record<string, string>; link: NotificationLink | null; dedupeKey: string | null; createdBy: Types.ObjectId | null },
  ): Promise<NotificationDoc | null> {
    const channel = patient.preferredChannel;
    if (channel !== 'sms' && channel !== 'voice') return null;
    const blocked = blockedReason(patient, channel);
    const now = this.now();
    try {
      const [doc] = await NotificationModel.create([
        {
          organisationId: patient.organisationId,
          recipient: { type: 'patient', id: patient._id },
          channel,
          templateKey: n.templateKey,
          params: n.params,
          language: patient.preferredLanguage,
          link: n.link,
          status: blocked ? 'blocked_no_consent' : 'queued',
          lastError: blocked,
          scheduledFor: now,
          dedupeKey: n.dedupeKey,
          createdBy: n.createdBy,
        },
      ]);
      return doc!.toObject();
    } catch (err) {
      if (isDuplicateKey(err)) return null;
      throw err;
    }
  }

  /**
   * A reminder for one appointment or referral, sent by programme staff. The text comes from the
   * template and the record; at most one manual reminder per record per day.
   */
  async sendReminder(auth: AuthContext, input: SendReminderInput, ctx: RequestContext): Promise<NotificationDto> {
    const today = isoDay(this.now());
    let patientId: Types.ObjectId;
    let templateKey: NotificationTemplateKey;
    let params: Record<string, string>;
    let link: NotificationLink;
    if (input.appointmentId) {
      const a = await AppointmentModel.findOne(withinScope<AppointmentDoc>({ _id: input.appointmentId }, await appointmentScopeFilter(auth.scope))).lean<AppointmentDoc>();
      if (!a) throw AppError.notFound('Appointment');
      if (a.status !== 'scheduled' || a.scheduledFor < today) throw new AppError('CONFLICT', 'Reminders can only be sent for upcoming scheduled appointments.');
      const facility = await FacilityModel.findById(a.facilityId).select('name').lean();
      patientId = a.patientId;
      templateKey = 'appointment_reminder';
      params = { facility: facility?.name ?? '', date: displayDate(a.scheduledFor) };
      link = { type: 'appointment', id: String(a._id) };
    } else {
      const r = await ReferralModel.findOne(withinScope<ReferralDoc>({ _id: input.referralId }, await referralScopeFilter(auth.scope))).lean<ReferralDoc>();
      if (!r) throw AppError.notFound('Referral');
      if (r.status !== 'issued') throw new AppError('CONFLICT', 'Reminders can only be sent while the patient is still expected at the facility.');
      const facility = await FacilityModel.findById(r.toFacilityId).select('name').lean();
      patientId = r.patientId;
      templateKey = 'referral_reminder';
      params = { facility: facility?.name ?? '', date: displayDate(r.expectedArrivalBy), code: r.referralCode };
      link = { type: 'referral', id: String(r._id) };
    }
    const patient = await PatientModel.findById(patientId).lean<PatientDoc>();
    if (!patient) throw AppError.notFound('Patient');
    if (patient.preferredChannel !== 'sms' && patient.preferredChannel !== 'voice') {
      throw new AppError('CONFLICT', 'This patient has not chosen SMS or voice reminders.');
    }
    const doc = await this.queueForPatient(patient, { templateKey, params, link, dedupeKey: `manual:${link.type}:${link.id}:${today}`, createdBy: auth.userId });
    if (!doc) throw new AppError('CONFLICT', 'A reminder for this was already sent today.');
    await this.deps.audit.record({ action: 'notification.send', auth, organisationId: patient.organisationId, entityType: 'notification', entityId: doc._id, metadata: { templateKey, channel: doc.channel, status: doc.status } }, ctx);
    void this.dispatch().catch((err) => this.deps.logger.error({ err }, 'Notification dispatch failed'));
    return (await this.historyDtos([doc]))[0]!;
  }

  /** Day-before appointment reminders for organisations that switched them on. */
  async planReminders(): Promise<number> {
    const now = this.now();
    const tomorrow = isoDay(new Date(now.getTime() + 86_400_000));
    const orgs = (await ProgrammeSettingsModel.find({ appointmentReminders: true }).select('organisationId').lean()).map((s) => s.organisationId);
    if (!orgs.length) return 0;
    let planned = 0;
    const keyOf = (a: { _id: Types.ObjectId; scheduledFor: string }) => `appt-reminder:${String(a._id)}:${a.scheduledFor}`;
    const all = await AppointmentModel.find({ organisationId: { $in: orgs }, status: 'scheduled', scheduledFor: tomorrow }).select('patientId facilityId scheduledFor').lean();
    // This runs every minute: skip appointments already handled without touching their patients.
    const done = new Set((await NotificationModel.find({ dedupeKey: { $in: all.map(keyOf) } }).select('dedupeKey').lean()).map((n) => n.dedupeKey));
    const appts = all.filter((a) => !done.has(keyOf(a)));
    const facilityNames = new Map(
      (await FacilityModel.find({ _id: { $in: [...new Set(appts.map((a) => String(a.facilityId)))] } }).select('name').lean()).map((f) => [String(f._id), f.name]),
    );
    for (const a of appts) {
      const patient = await PatientModel.findById(a.patientId).lean<PatientDoc>();
      if (!patient || (patient.preferredChannel !== 'sms' && patient.preferredChannel !== 'voice')) continue;
      const doc = await this.queueForPatient(patient, {
        templateKey: 'appointment_reminder',
        params: { facility: facilityNames.get(String(a.facilityId)) ?? '', date: displayDate(a.scheduledFor) },
        link: { type: 'appointment', id: String(a._id) },
        // Per appointment AND date: a rescheduled appointment gets a new reminder.
        dedupeKey: keyOf(a),
        createdBy: null,
      });
      if (doc) planned++;
    }
    return planned;
  }

  // ── Dispatcher ────────────────────────────────────────────────────────────────
  /** Plans reminders and sends what is due. Overlapping calls share one run. */
  dispatch(): Promise<DispatchRunResult> {
    this.running ??= this.runDispatch().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runDispatch(): Promise<DispatchRunResult> {
    const result: DispatchRunResult = { remindersPlanned: await this.planReminders(), processed: 0, sent: 0, failed: 0, notSent: 0, blocked: 0 };
    const now = this.now();
    // A crash mid-send leaves "sending" claims; give them back after a while.
    await NotificationModel.updateMany({ status: 'sending', claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } }, { $set: { status: 'queued', claimedAt: null } });

    for (let i = 0; i < BATCH; i++) {
      // Atomic claim: several API replicas can run this safely.
      const claimed = await NotificationModel.findOneAndUpdate(
        { status: 'queued', scheduledFor: { $lte: now }, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] },
        { $set: { status: 'sending', claimedAt: now } },
        { sort: { scheduledFor: 1 }, returnDocument: 'after' },
      ).lean<NotificationDoc>();
      if (!claimed) break;
      result.processed++;
      const outcome = await this.deliver(claimed);
      if (outcome === 'sent') result.sent++;
      else if (outcome === 'failed') result.failed++;
      else if (outcome === 'blocked') result.blocked++;
      else if (outcome === 'no_provider') result.notSent++;
    }
    if (result.processed || result.remindersPlanned) this.deps.logger.info({ ...result }, 'Notification dispatch finished');
    return result;
  }

  private async deliver(n: NotificationDoc): Promise<'sent' | 'failed' | 'blocked' | 'no_provider' | 'retry'> {
    const set = (fields: Partial<NotificationDoc>) => NotificationModel.updateOne({ _id: n._id, status: 'sending' }, { $set: { claimedAt: null, ...fields } });
    if (n.channel === 'in_app') {
      await set({ status: 'delivered', sentAt: this.now() });
      return 'sent';
    }
    if (n.channel === 'push' || n.recipient.type !== 'patient') {
      await set({ status: 'not_sent_no_provider', lastError: 'Push delivery is not set up' });
      return 'no_provider';
    }
    const patient = await PatientModel.findById(n.recipient.id).select('status phone consent').lean<PatientDoc>();
    const blocked = blockedReason(patient, n.channel);
    if (blocked) {
      await set({ status: 'blocked_no_consent', lastError: blocked });
      return 'blocked';
    }
    const provider = this.deps.providers[n.channel];
    if (!provider) {
      await set({ status: 'not_sent_no_provider', lastError: `No ${n.channel === 'sms' ? 'SMS' : 'voice'} provider is configured` });
      return 'no_provider';
    }
    const attempts = n.attempts + 1;
    try {
      const res = await provider.send({ notificationId: String(n._id), to: patient!.phone!, text: renderNotification(n.templateKey, n.language, n.params ?? {}), language: n.language });
      await set({ status: 'sent', attempts, sentAt: this.now(), provider: provider.name, providerMessageId: res.providerMessageId, lastError: null });
      return 'sent';
    } catch (err) {
      const retry = err instanceof TransientProviderError && attempts < MAX_ATTEMPTS;
      await set(
        retry
          ? { status: 'queued', attempts, nextAttemptAt: new Date(this.now().getTime() + 60_000 * 2 ** (attempts - 1)), lastError: safeError(err), provider: provider.name }
          : { status: 'failed', attempts, lastError: safeError(err), provider: provider.name },
      );
      return retry ? 'retry' : 'failed';
    }
  }

  start(intervalSeconds: number): () => void {
    const tick = () => void this.dispatch().catch((err) => this.deps.logger.error({ err }, 'Notification dispatch failed'));
    const timer = setInterval(tick, intervalSeconds * 1000);
    timer.unref();
    setTimeout(tick, 15_000).unref();
    return () => clearInterval(timer);
  }
}
