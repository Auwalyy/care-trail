import { z } from 'zod';
import { objectIdSchema } from './common.js';

/** Shared list query for organisations, facilities and communities. */
export const directoryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  organisationId: objectIdSchema.optional(),
});
export type DirectoryListQuery = z.infer<typeof directoryListQuerySchema>;
