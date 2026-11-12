import { z } from 'zod';
import { REFERRAL_PRIORITIES, REFERRAL_STATUSES, TEMPLATE_STATUSES } from '@caretrail/shared-types';
import { clientIdSchema, objectIdSchema, versionSchema } from './common.js';

const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max);
const optionalNote = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v))
  .nullish();

export const createReferralSchema = z.object({
  clientId: clientIdSchema.optional(),
  patientId: objectIdSchema,
  toFacilityId: objectIdSchema,
  /** Why the patient is being referred — recorded by an authorised worker. Shown to the facility, not printed on the receipt. */
  reason: text(3, 500, 'Describe the reason for referral'),
  /** Approved instruction templates only. */
  instructionTemplateIds: z.array(objectIdSchema).max(10).default([]),
});
export type CreateReferralInput = z.infer<typeof createReferralSchema>;

export const referralTransitionSchema = z
  .object({
    toStatus: z.enum(REFERRAL_STATUSES),
    note: optionalNote,
    /** Required when recording the service provided. */
    serviceSummary: z
      .string()
      .trim()
      .max(500)
      .transform((v) => (v === '' ? null : v))
      .nullish(),
    version: versionSchema,
  })
  .refine((v) => v.toStatus !== 'service_recorded' || Boolean(v.serviceSummary), {
    message: 'Describe the services provided',
    path: ['serviceSummary'],
  });
export type ReferralTransitionInput = z.infer<typeof referralTransitionSchema>;

export const referralPrioritySchema = z.object({ priority: z.enum(REFERRAL_PRIORITIES), version: versionSchema });

export const listReferralsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['issuedAt', '-issuedAt', 'expectedArrivalBy', '-expectedArrivalBy']).default('-issuedAt'),
  /** Comma-separated statuses, e.g. "issued,patient_arrived". */
  status: z
    .string()
    .trim()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.enum(REFERRAL_STATUSES)).max(REFERRAL_STATUSES.length))
    .optional(),
  open: z.enum(['true']).optional(),
  overdue: z.enum(['true']).optional(),
  toFacilityId: objectIdSchema.optional(),
  patientId: objectIdSchema.optional(),
  /** Referral code prefix. */
  q: z
    .string()
    .trim()
    .max(12)
    .optional(),
  organisationId: objectIdSchema.optional(),
});
export type ListReferralsQuery = z.infer<typeof listReferralsQuerySchema>;

// ── Instruction templates ───────────────────────────────────────────────────────
export const createTemplateSchema = z.object({
  organisationId: objectIdSchema.nullish(),
  title: text(3, 120, 'Enter a title'),
  body: text(3, 1000, 'Enter the English instruction text'),
  bodyHa: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => (v === '' ? null : v))
    .nullish(),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z
  .object({
    title: text(3, 120, 'Enter a title').optional(),
    body: text(3, 1000, 'Enter the English instruction text').optional(),
    bodyHa: createTemplateSchema.shape.bodyHa,
    status: z.enum(['retired']).optional(),
    version: versionSchema,
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update');
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

/** A clinical reviewer's approval, recorded by an administrator. */
export const approveTemplateSchema = z.object({
  reviewerName: text(3, 120, "Enter the reviewer's name"),
  reviewerCredentials: text(2, 120, "Enter the reviewer's qualification, e.g. Registered Midwife"),
  approvedOn: z.iso.date().refine((d) => d <= new Date().toISOString().slice(0, 10), 'Approval date cannot be in the future'),
  version: versionSchema,
});
export type ApproveTemplateInput = z.infer<typeof approveTemplateSchema>;

export const listTemplatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(TEMPLATE_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  organisationId: objectIdSchema.optional(),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;
