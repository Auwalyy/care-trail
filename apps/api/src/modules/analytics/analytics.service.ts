import { Types } from 'mongoose';
import { OPEN_REFERRAL_STATUSES, type FollowUpStatus, type OverviewDto } from '@caretrail/shared-types';
import { organisationFilter, withinScope, type AccessScope } from '../access/access-scope.js';
import { PatientModel, type PatientDoc } from '../patients/patient.model.js';
import { patientScopeFilter } from '../patients/patient.repository.js';
import { ReferralModel, type ReferralDoc } from '../referrals/referral.model.js';
import { referralScopeFilter } from '../referrals/referral.service.js';
import { AppointmentModel, type AppointmentDoc } from '../appointments/appointment.model.js';
import { appointmentScopeFilter } from '../appointments/appointment.service.js';
import { FollowUpTaskModel, type FollowUpTaskDoc } from '../follow-ups/follow-up.model.js';
import { taskScopeFilter } from '../follow-ups/follow-up.service.js';
import { CommunityModel } from '../communities/community.model.js';
import { FacilityModel } from '../facilities/facility.model.js';
import type { SettingsService } from '../settings/settings.service.js';
import { UserModel } from '../users/user.model.js';

/**
 * Aggregated programme figures. Counts only — never personal data. Patient, referral and
 * follow-up figures are added as those modules are built (Phases 4–6, 10).
 */
export class AnalyticsService {
  constructor(private readonly deps: { settings: SettingsService }) {}

  async overview(scope: AccessScope, requestedOrg?: string): Promise<OverviewDto> {
    const orgFilter = organisationFilter(scope, requestedOrg);
    const organisationId = orgFilter.organisationId ? String(orgFilter.organisationId) : null;
    const ref = { ...orgFilter, deletedAt: null };

    const [facActive, facTotal, comActive, comTotal, chwByStatus, staffActive, staffTotal] = await Promise.all([
      FacilityModel.countDocuments({ ...ref, status: 'active' }),
      FacilityModel.countDocuments(ref),
      CommunityModel.countDocuments({ ...ref, status: 'active' }),
      CommunityModel.countDocuments(ref),
      UserModel.aggregate<{ _id: string; n: number }>([
        { $match: { ...(organisationId ? { organisationId: new Types.ObjectId(organisationId) } : {}), role: 'chw' } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      UserModel.countDocuments({ ...orgFilter, role: { $nin: ['chw', 'platform_admin'] }, status: 'active' }),
      UserModel.countDocuments({ ...orgFilter, role: { $nin: ['chw', 'platform_admin'] } }),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const patientFilter = withinScope<PatientDoc>(orgFilter, patientScopeFilter(scope));
    const referralFilter = withinScope<ReferralDoc>(orgFilter, await referralScopeFilter(scope));
    const [patActive, patTotal, refOpen, refCompleted, refOverdue, refTotal] = await Promise.all([
      PatientModel.countDocuments(withinScope<PatientDoc>(patientFilter, { status: 'active' })),
      PatientModel.countDocuments(patientFilter),
      ReferralModel.countDocuments(withinScope<ReferralDoc>(referralFilter, { status: { $in: OPEN_REFERRAL_STATUSES } })),
      ReferralModel.countDocuments(withinScope<ReferralDoc>(referralFilter, { status: 'completed' })),
      ReferralModel.countDocuments(withinScope<ReferralDoc>(referralFilter, { status: { $in: ['issued', 'expired'] }, expectedArrivalBy: { $lt: today } })),
      ReferralModel.countDocuments(referralFilter),
    ]);
    const in7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const apptFilter = withinScope<AppointmentDoc>(orgFilter, await appointmentScopeFilter(scope));
    const userId = scope.kind === 'chw' ? scope.userId : new Types.ObjectId();
    const taskFilter = withinScope<FollowUpTaskDoc>(orgFilter, taskScopeFilter(scope, userId));
    const open: FollowUpStatus[] = ['pending', 'assigned', 'in_progress', 'contacted'];
    const [apUpcoming, apMissed, apAttended, apTotal, fuOpen, fuOverdue, fuEscalated, fuResolved, fuReached] = await Promise.all([
      AppointmentModel.countDocuments(withinScope<AppointmentDoc>(apptFilter, { status: 'scheduled', scheduledFor: { $gte: today, $lte: in7 } })),
      AppointmentModel.countDocuments(withinScope<AppointmentDoc>(apptFilter, { status: 'missed' })),
      AppointmentModel.countDocuments(withinScope<AppointmentDoc>(apptFilter, { status: 'attended' })),
      AppointmentModel.countDocuments(apptFilter),
      FollowUpTaskModel.countDocuments(withinScope<FollowUpTaskDoc>(taskFilter, { status: { $in: open } })),
      FollowUpTaskModel.countDocuments(withinScope<FollowUpTaskDoc>(taskFilter, { status: { $in: open }, dueOn: { $lt: today } })),
      FollowUpTaskModel.countDocuments(withinScope<FollowUpTaskDoc>(taskFilter, { status: 'escalated' })),
      FollowUpTaskModel.countDocuments(withinScope<FollowUpTaskDoc>(taskFilter, { status: 'resolved' })),
      FollowUpTaskModel.countDocuments(withinScope<FollowUpTaskDoc>(taskFilter, { status: 'resolved', 'attempts.reached': true })),
    ]);
    const chw = Object.fromEntries(chwByStatus.map((r) => [r._id, r.n])) as Record<string, number>;

    return {
      organisationId,
      facilities: { active: facActive, total: facTotal },
      communities: { active: comActive, total: comTotal },
      chws: {
        active: chw.active ?? 0,
        pendingActivation: chw.pending_activation ?? 0,
        total: (chw.active ?? 0) + (chw.pending_activation ?? 0) + (chw.inactive ?? 0),
      },
      staff: { active: staffActive, total: staffTotal },
      patients: { active: patActive, total: patTotal },
      referrals: { open: refOpen, completed: refCompleted, overdue: refOverdue, total: refTotal },
      appointments: { upcoming7d: apUpcoming, missed: apMissed, attended: apAttended, total: apTotal },
      followUps: { open: fuOpen, overdue: fuOverdue, escalated: fuEscalated, resolved: fuResolved, reachedRate: fuResolved ? Math.round((fuReached / fuResolved) * 100) : null },
      pilot: organisationId ? (await this.deps.settings.forOrganisation(new Types.ObjectId(organisationId))).pilot : null,
      generatedAt: new Date().toISOString(),
    };
  }
}
