import { Types } from 'mongoose';
import { checkReferralTransition, type MissedCareRunResult } from '@caretrail/shared-types';
import type { Logger } from '../../utils/logger.js';
import { AppointmentModel, type AppointmentDoc } from '../appointments/appointment.model.js';
import type { AuditService } from '../audit/audit.service.js';
import { OrganisationModel } from '../organisations/organisation.model.js';
import { ReferralEventModel } from '../referrals/referral-event.model.js';
import { ReferralModel, type ReferralDoc } from '../referrals/referral.model.js';
import type { SettingsService } from '../settings/settings.service.js';
import { addDays, ensureTask, todayIso } from './follow-up.service.js';

/** Days a CHW has to act on an automatically created task. */
const TASK_DUE_DAYS = 2;

/**
 * Finds missed care and creates follow-up tasks for the responsible CHW:
 *  - appointments past their date + grace with no attendance → "missed"
 *  - referrals still awaiting arrival after the expected date → "expired" (system event)
 *  - referrals the facility marked as needing further follow-up
 *
 * Uses the SERVER clock only. Idempotent: every write is conditional and open tasks are unique per
 * source+reason, so it can run repeatedly or concurrently on several instances safely.
 */
export class MissedCareService {
  constructor(private readonly deps: { settings: SettingsService; audit: AuditService; logger: Logger; now?: () => Date }) {}

  async run(organisationId?: Types.ObjectId): Promise<MissedCareRunResult> {
    const now = this.deps.now?.() ?? new Date();
    const today = todayIso(now);
    const dueOn = addDays(today, TASK_DUE_DAYS);
    const result: MissedCareRunResult = { ranAt: now.toISOString(), appointmentsMarkedMissed: 0, referralsExpired: 0, tasksCreated: 0 };
    const orgs = await OrganisationModel.find({ status: 'active', ...(organisationId ? { _id: organisationId } : {}) }).select('_id').lean();

    for (const { _id: orgId } of orgs) {
      const settings = await this.deps.settings.forOrganisation(orgId);

      // 1. Missed appointments (date + grace has passed without attendance).
      const missedBefore = addDays(today, -settings.appointmentOverdueGraceDays);
      const appointments = await AppointmentModel.find({ organisationId: orgId, status: 'scheduled', scheduledFor: { $lt: missedBefore } }).lean<AppointmentDoc[]>();
      for (const a of appointments) {
        const marked = await AppointmentModel.updateOne({ _id: a._id, status: 'scheduled', version: a.version }, { $set: { status: 'missed', missedDetectedAt: now }, $inc: { version: 1 } });
        if (marked.modifiedCount) result.appointmentsMarkedMissed++;
        if (await ensureTask({ organisationId: orgId, patientId: a.patientId, source: { type: 'appointment', id: a._id }, reason: 'missed_appointment', dueOn })) result.tasksCreated++;
      }

      // 2. Referrals not confirmed at the facility by the expected date.
      const late = await ReferralModel.find({ organisationId: orgId, status: { $in: ['issued', 'expired'] }, expectedArrivalBy: { $lt: today } }).lean<ReferralDoc[]>();
      for (const r of late) {
        if (r.status === 'issued' && checkReferralTransition('issued', 'expired', 'system').allowed) {
          const expired = await ReferralModel.updateOne({ _id: r._id, status: 'issued', version: r.version }, { $set: { status: 'expired' }, $inc: { version: 1 } });
          if (expired.modifiedCount) {
            result.referralsExpired++;
            await ReferralEventModel.create({ organisationId: orgId, referralId: r._id, patientId: r.patientId, kind: 'status', fromStatus: 'issued', toStatus: 'expired', actorId: null, actorRole: 'system', facilityId: null, at: now, note: 'Not confirmed at the facility by the expected date', source: 'system' });
          }
        }
        if (await ensureTask({ organisationId: orgId, patientId: r.patientId, source: { type: 'referral', id: r._id }, reason: 'referral_not_arrived', dueOn })) result.tasksCreated++;
      }

      // 3. Referrals the facility says need further follow-up in the community.
      const incomplete = await ReferralModel.find({ organisationId: orgId, status: 'follow_up_required' }).select('_id patientId followUpNote').lean<ReferralDoc[]>();
      for (const r of incomplete) {
        if (await ensureTask({ organisationId: orgId, patientId: r.patientId, source: { type: 'referral', id: r._id }, reason: 'referral_incomplete', dueOn, note: r.followUpNote })) result.tasksCreated++;
      }
    }

    if (result.appointmentsMarkedMissed || result.referralsExpired || result.tasksCreated) {
      await this.deps.audit.record({ action: 'system.missed_care_check', organisationId: organisationId ?? null, metadata: { ...result } }, null);
    }
    this.deps.logger.info({ ...result }, 'Missed-care check completed');
    return result;
  }

  /** In-process scheduler. Safe with several API instances because the run is idempotent. */
  start(intervalMinutes: number): () => void {
    const tick = () => void this.run().catch((err) => this.deps.logger.error({ err }, 'Missed-care check failed'));
    const timer = setInterval(tick, intervalMinutes * 60_000);
    timer.unref();
    setTimeout(tick, 10_000).unref(); // shortly after start-up
    return () => clearInterval(timer);
  }
}
