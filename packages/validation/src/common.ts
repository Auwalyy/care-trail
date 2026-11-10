import { z } from 'zod';
import { LANGUAGES, isValidReferralCode, normaliseReferralCode } from '@caretrail/shared-types';

/** 24-hex MongoDB ObjectId as a string. */
export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');

/** Client-generated UUID (v4/v7) used for offline local IDs and idempotency keys. */
export const clientIdSchema = z.uuid();

export const languageSchema = z.enum(LANGUAGES);

/**
 * Nigerian phone number, normalised to E.164 (+234XXXXXXXXXX).
 * Accepts 0803..., 803..., 234803..., +234803...
 */
export const nigerianPhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .transform((v) => {
    if (v.startsWith('+234')) return v;
    if (v.startsWith('234')) return `+${v}`;
    if (v.startsWith('0')) return `+234${v.slice(1)}`;
    return `+234${v}`;
  })
  .pipe(z.string().regex(/^\+234[789][01]\d{8}$/, 'Invalid Nigerian phone number'));

export const referralCodeSchema = z
  .string()
  .trim()
  .refine(isValidReferralCode, 'Invalid referral code — please check the receipt')
  .transform((v) => normaliseReferralCode(v) as string);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z][a-zA-Z0-9_.]*$/, 'Invalid sort field')
    .optional(),
  q: z.string().trim().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const dateRangeQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: '`from` must be before `to`',
    path: ['from'],
  });

/** Optimistic-concurrency version carried on every update request. */
export const versionSchema = z.number().int().min(0);
