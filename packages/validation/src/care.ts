import { z } from 'zod';
import { APPOINTMENT_CATEGORIES, APPOINTMENT_STATUSES, CONTACT_METHODS, FOLLOW_UP_REASONS, FOLLOW_UP_STATUSES } from '@caretrail/shared-types';
import { clientIdSchema, objectIdSchema, versionSchema } from './common.js';

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const futureDate = z.iso.date('Use the format YYYY-MM-DD').refine((d) => d >= today() && d <= plusDays(366), 'Choose a date from today up to one year ahead');
const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

// ── Appointments ────────────────────────────────────────────────────────────────
export const createAppointmentSchema = z.object({
  clientId: clientIdSchema.optional(),
  patientId: objectIdSchema,
  /** Facility staff book at their own facility; others choose. */
  facilityId: objectIdSchema.nullish(),
  category: z.enum(APPOINTMENT_CATEGORIES),
  scheduledFor: futureDate,
});
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({ scheduledFor: futureDate, version: versionSchema });
export const cancelAppointmentSchema = z.object({ reason: text(3, 300, 'Give a reason'), version: versionSchema });
export const attendanceSchema = z.object({ outcome: z.enum(['attended', 'missed']), version: versionSchema });

export const listAppointmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .string()
    .trim()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.enum(APPOINTMENT_STATUSES)))
    .optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  facilityId: objectIdSchema.optional(),
  patientId: objectIdSchema.optional(),
  category: z.enum(APPOINTMENT_CATEGORIES).optional(),
  sort: z.enum(['scheduledFor', '-scheduledFor']).default('scheduledFor'),
  organisationId: objectIdSchema.optional(),
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

// ── Follow-up tasks ─────────────────────────────────────────────────────────────
export const createFollowUpSchema = z.object({
  clientId: clientIdSchema.optional(),
  patientId: objectIdSchema,
  dueOn: futureDate,
  note: text(3, 500, 'Describe what needs to happen'),
});
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;

export const contactAttemptSchema = z.object({
  method: z.enum(CONTACT_METHODS),
  reached: z.boolean(),
  response: optionalText(500),
  version: versionSchema,
});
export type ContactAttemptInput = z.infer<typeof contactAttemptSchema>;

export const resolveFollowUpSchema = z.object({
  outcome: text(3, 500, 'Describe the outcome'),
  nextAction: optionalText(300),
  version: versionSchema,
});
export const escalateFollowUpSchema = z.object({ notes: text(3, 500, 'Explain why this needs escalation'), version: versionSchema });
export const updateFollowUpSchema = z
  .object({ status: z.enum(['assigned', 'in_progress']).optional(), dueOn: futureDate.optional(), nextAction: optionalText(300), version: versionSchema })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update');

export const listFollowUpsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .string()
    .trim()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.enum(FOLLOW_UP_STATUSES)))
    .optional(),
  open: z.enum(['true']).optional(),
  overdue: z.enum(['true']).optional(),
  reason: z.enum(FOLLOW_UP_REASONS).optional(),
  assignedChwId: objectIdSchema.optional(),
  patientId: objectIdSchema.optional(),
  organisationId: objectIdSchema.optional(),
});
export type ListFollowUpsQuery = z.infer<typeof listFollowUpsQuerySchema>;
