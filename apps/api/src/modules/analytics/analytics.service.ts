import { Types } from 'mongoose';
import type { OverviewDto } from '@caretrail/shared-types';
import { organisationFilter, type AccessScope } from '../access/access-scope.js';
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
      pilot: organisationId ? (await this.deps.settings.forOrganisation(new Types.ObjectId(organisationId))).pilot : null,
      generatedAt: new Date().toISOString(),
    };
  }
}
