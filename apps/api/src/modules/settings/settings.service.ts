import type { Types } from 'mongoose';
import { DEFAULT_PROGRAMME_SETTINGS, type ProgrammeSettingsDto } from '@caretrail/shared-types';
import type { UpdateSettingsInput } from '@caretrail/validation';
import type { AuthContext, RequestContext } from '../../types/context.js';
import { AppError } from '../../utils/app-error.js';
import { updateVersioned } from '../../utils/versioned.js';
import { resolveTargetOrganisation } from '../access/access-scope.js';
import type { AuditService } from '../audit/audit.service.js';
import { ProgrammeSettingsModel, type ProgrammeSettingsDoc } from './settings.model.js';

function toDto(organisationId: Types.ObjectId, doc: ProgrammeSettingsDoc | null): ProgrammeSettingsDto {
  if (!doc) {
    // Not yet configured: pilot targets are unset (the proposed pilot is not a confirmed deployment).
    return {
      organisationId: String(organisationId),
      pilot: { communities: null, facilities: null, chws: null, patients: null, durationWeeks: null, startDate: null },
      ...DEFAULT_PROGRAMME_SETTINGS,
      configured: false,
      version: 0,
      updatedAt: null,
    };
  }
  return {
    organisationId: String(organisationId),
    pilot: { ...doc.pilot },
    referralExpectedArrivalDays: doc.referralExpectedArrivalDays,
    appointmentOverdueGraceDays: doc.appointmentOverdueGraceDays,
    offlineSessionGraceDays: doc.offlineSessionGraceDays,
    consentTextVersion: doc.consentTextVersion ?? null,
    configured: true,
    version: doc.version,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class SettingsService {
  constructor(private readonly deps: { audit: AuditService }) {}

  /** Settings for an organisation, or the defaults if never saved. Used by other modules too. */
  async forOrganisation(organisationId: Types.ObjectId): Promise<ProgrammeSettingsDto> {
    return toDto(organisationId, await ProgrammeSettingsModel.findOne({ organisationId }).lean<ProgrammeSettingsDoc>());
  }

  async get(auth: AuthContext, requestedOrg?: string): Promise<ProgrammeSettingsDto> {
    return this.forOrganisation(await resolveTargetOrganisation(auth.scope, requestedOrg));
  }

  async update(auth: AuthContext, requestedOrg: string | undefined, input: UpdateSettingsInput, ctx: RequestContext): Promise<ProgrammeSettingsDto> {
    const organisationId = await resolveTargetOrganisation(auth.scope, requestedOrg);
    const { version, consentTextVersion, ...rest } = input;
    // An omitted consentTextVersion keeps the stored value (older clients don't send it).
    const values = consentTextVersion === undefined ? rest : { ...rest, consentTextVersion };
    let saved: ProgrammeSettingsDoc;

    if (version === 0) {
      // First save: create, unless someone else created it concurrently.
      try {
        saved = (await ProgrammeSettingsModel.create({ organisationId, ...values, updatedBy: auth.userId, version: 1 })).toObject();
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
        const current = await this.forOrganisation(organisationId);
        throw new AppError('VERSION_CONFLICT', 'Settings were saved by someone else. Reload and try again.', { current: current as unknown as Record<string, unknown> });
      }
    } else {
      saved = await updateVersioned(
        ProgrammeSettingsModel,
        { organisationId },
        version,
        { $set: { ...values, updatedBy: auth.userId } },
        (d) => toDto(organisationId, d),
      );
    }
    await this.deps.audit.record({ action: 'settings.update', auth, organisationId, entityType: 'settings', entityId: saved._id }, ctx);
    return toDto(organisationId, saved);
  }
}
