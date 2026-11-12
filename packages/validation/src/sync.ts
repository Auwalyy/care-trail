import { z } from 'zod';
import { SYNC_OP_TYPES, VISIT_OUTCOMES } from '@caretrail/shared-types';
import { clientIdSchema, objectIdSchema } from './common.js';

const today = () => new Date().toISOString().slice(0, 10);

export const createVisitSchema = z
  .object({
    clientId: clientIdSchema.optional(),
    patientId: objectIdSchema,
    visitDate: z.iso.date().refine((d) => d <= today(), 'Visit date cannot be in the future'),
    outcome: z.enum(VISIT_OUTCOMES),
    followUpRequired: z.boolean().default(false),
    nextActivityDate: z.iso.date().nullish(),
    /** Operational notes only (e.g. "came back in the afternoon"), never clinical findings. */
    notes: z
      .string()
      .trim()
      .max(500)
      .transform((v) => (v === '' ? null : v))
      .nullish(),
  })
  .refine((v) => !v.nextActivityDate || v.nextActivityDate >= v.visitDate, { message: 'The next activity must be after the visit', path: ['nextActivityDate'] });
export type CreateVisitInput = z.infer<typeof createVisitSchema>;

export const listVisitsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  patientId: objectIdSchema.optional(),
});
export type ListVisitsQuery = z.infer<typeof listVisitsQuerySchema>;

export const syncOperationSchema = z.object({
  opId: z.uuid(),
  opType: z.enum(SYNC_OP_TYPES),
  targetId: objectIdSchema.nullish(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime({ offset: true }),
});

export const syncPushSchema = z.object({
  deviceId: z.string().trim().min(8).max(100),
  appVersion: z.string().trim().max(40),
  pendingOperations: z.number().int().min(0).max(100_000),
  /** Small batches: rural connections are slow and may drop. */
  operations: z.array(syncOperationSchema).min(1).max(25),
});

export const syncPullQuerySchema = z.object({ since: z.iso.datetime({ offset: true }).optional() });
