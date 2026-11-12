import { z } from 'zod';
import { REPORT_KEYS } from '@caretrail/shared-types';
import { objectIdSchema } from './common.js';

const MAX_DAYS = 731;
export const reportQuerySchema = z
  .object({
    report: z.enum(REPORT_KEYS),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    organisationId: objectIdSchema.optional(),
    facilityId: objectIdSchema.optional(),
    communityId: objectIdSchema.optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .superRefine((v, ctx) => {
    if (v.from && v.to) {
      if (v.from > v.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'The end date is before the start date' });
      else if ((Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 > MAX_DAYS) ctx.addIssue({ code: 'custom', path: ['from'], message: 'Choose a period of at most two years' });
    }
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;
