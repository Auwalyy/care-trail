import { z } from 'zod';
import { LANGUAGES, USER_STATUSES } from '@caretrail/shared-types';
import { emailSchema } from './auth.js';
import { nigerianPhoneSchema, objectIdSchema, versionSchema } from './common.js';

const programmeAreas = z.array(z.string().trim().min(2).max(60)).max(10);

// ── CHWs ──────────────────────────────────────────────────────────────────────
export const createChwSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  email: emailSchema,
  phone: nigerianPhoneSchema.nullish(),
  preferredLanguage: z.enum(LANGUAGES).default('ha'),
  organisationId: objectIdSchema.nullish(),
  communityIds: z.array(objectIdSchema).min(1, 'Assign at least one community').max(20),
  programmeAreas: programmeAreas.default([]),
  canIssueReferrals: z.boolean().default(false),
  supervisorUserId: objectIdSchema.nullish(),
});
export type CreateChwInput = z.infer<typeof createChwSchema>;

export const updateChwSchema = z
  .object({
    communityIds: z.array(objectIdSchema).min(1, 'Assign at least one community').max(20).optional(),
    programmeAreas: programmeAreas.optional(),
    canIssueReferrals: z.boolean().optional(),
    supervisorUserId: objectIdSchema.nullish(),
    version: versionSchema,
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update');
export type UpdateChwInput = z.infer<typeof updateChwSchema>;

export const listChwsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  communityId: objectIdSchema.optional(),
  status: z.enum(USER_STATUSES).optional(),
  organisationId: objectIdSchema.optional(),
});
export type ListChwsQuery = z.infer<typeof listChwsQuerySchema>;

// ── Programme settings ────────────────────────────────────────────────────────
const target = (max: number) => z.number().int().min(1).max(max).nullable();

export const updateSettingsSchema = z.object({
  pilot: z.object({
    communities: target(1_000),
    facilities: target(1_000),
    chws: target(10_000),
    patients: target(1_000_000),
    durationWeeks: target(520),
    startDate: z.iso.date().nullable(),
  }),
  referralExpectedArrivalDays: z.number().int().min(1).max(60),
  appointmentOverdueGraceDays: z.number().int().min(0).max(14),
  offlineSessionGraceDays: z.number().int().min(1).max(60),
  /** Omit to keep the current value; null or "" clears it. */
  consentTextVersion: z.string().trim().max(40).transform((v) => (v === "" ? null : v)).nullish(),
  version: versionSchema,
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const organisationScopeQuerySchema = z.object({ organisationId: objectIdSchema.optional() });

// ── Audit log ─────────────────────────────────────────────────────────────────
export const listAuditLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    action: z
      .string()
      .trim()
      .regex(/^[a-z_.]+$/, 'Invalid action')
      .max(60)
      .optional(),
    outcome: z.enum(['success', 'failure']).optional(),
    entityType: z.string().trim().regex(/^[a-z_]+$/).max(40).optional(),
    entityId: objectIdSchema.optional(),
    actorId: objectIdSchema.optional(),
    organisationId: objectIdSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: '`from` must be before `to`', path: ['from'] });
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
