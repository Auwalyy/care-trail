import { z } from 'zod';
import { EDUCATION_ACTIONS, EDUCATION_CATEGORIES, EDUCATION_STATUSES, NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES, NOTIFICATION_TEMPLATE_KEYS } from '@caretrail/shared-types';
import { objectIdSchema, versionSchema } from './common.js';

const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };

// ── Education ───────────────────────────────────────────────────────────────────
export const createEducationSchema = z
  .object({
    organisationId: objectIdSchema.nullish(),
    category: z.enum(EDUCATION_CATEGORIES),
    title: text(3, 120, 'Enter a title'),
    body: text(10, 5000, 'Enter the English text'),
    titleHa: optionalText(120),
    bodyHa: optionalText(5000),
  })
  .refine((v) => Boolean(v.titleHa) === Boolean(v.bodyHa), { path: ['bodyHa'], message: 'Give both the Hausa title and the Hausa text, or neither' });
export type CreateEducationInput = z.infer<typeof createEducationSchema>;

export const updateEducationSchema = z
  .object({
    category: z.enum(EDUCATION_CATEGORIES).optional(),
    title: text(3, 120, 'Enter a title').optional(),
    body: text(10, 5000, 'Enter the English text').optional(),
    titleHa: optionalText(120),
    bodyHa: optionalText(5000),
    version: versionSchema,
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update');
export type UpdateEducationInput = z.infer<typeof updateEducationSchema>;

export const educationTransitionSchema = z
  .object({
    action: z.enum(EDUCATION_ACTIONS),
    version: versionSchema,
    /** Required to return content to its author. */
    note: optionalText(1000),
    /** Required to approve: the clinical reviewer, as for referral instructions. */
    reviewerName: optionalText(120),
    reviewerCredentials: optionalText(120),
    approvedOn: z.iso.date().refine((d) => d <= new Date().toISOString().slice(0, 10), 'Approval date cannot be in the future').nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'return' && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Say what needs to change' });
    if (v.action === 'approve') {
      if (!v.reviewerName) ctx.addIssue({ code: 'custom', path: ['reviewerName'], message: "Enter the reviewer's name" });
      if (!v.reviewerCredentials) ctx.addIssue({ code: 'custom', path: ['reviewerCredentials'], message: "Enter the reviewer's qualification" });
      if (!v.approvedOn) ctx.addIssue({ code: 'custom', path: ['approvedOn'], message: 'Enter the approval date' });
    }
  });
export type EducationTransitionInput = z.infer<typeof educationTransitionSchema>;

export const listEducationQuerySchema = z.object({
  ...page,
  status: z.enum(EDUCATION_STATUSES).optional(),
  category: z.enum(EDUCATION_CATEGORIES).optional(),
  q: z.string().trim().max(100).optional(),
  organisationId: objectIdSchema.optional(),
});
export type ListEducationQuery = z.infer<typeof listEducationQuerySchema>;

export const audioParamsSchema = z.object({ id: objectIdSchema, lang: z.enum(['en', 'ha']) });

// ── Notifications ───────────────────────────────────────────────────────────────
export const inboxQuerySchema = z.object({
  ...page,
  unread: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export type InboxQuery = z.infer<typeof inboxQuerySchema>;

export const notificationHistoryQuerySchema = z.object({
  ...page,
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  templateKey: z.enum(NOTIFICATION_TEMPLATE_KEYS as [string, ...string[]]).optional(),
  patientId: objectIdSchema.optional(),
  organisationId: objectIdSchema.optional(),
});
export type NotificationHistoryQuery = z.infer<typeof notificationHistoryQuerySchema>;

/**
 * A manual reminder for one appointment or referral. Text is never free-form: the message is
 * built from the template and the record, so no medical details can be typed into an SMS.
 */
export const sendReminderSchema = z
  .object({
    appointmentId: objectIdSchema.optional(),
    referralId: objectIdSchema.optional(),
  })
  .refine((v) => Boolean(v.appointmentId) !== Boolean(v.referralId), 'Choose one appointment or one referral');
export type SendReminderInput = z.infer<typeof sendReminderSchema>;
