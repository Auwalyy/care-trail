import { z } from 'zod';
import { FACILITY_TYPES } from '@caretrail/shared-types';
import { emailSchema } from './auth.js';
import { nigerianPhoneSchema, objectIdSchema, versionSchema } from './common.js';

/** Shared list query for organisations, facilities and communities. */
export const directoryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  organisationId: objectIdSchema.optional(),
});
export type DirectoryListQuery = z.infer<typeof directoryListQuerySchema>;

const name = (max: number) => z.string().trim().min(2, 'Enter a name').max(max);
const place = z.string().trim().min(2, 'Required').max(80);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();
const code = (max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Use letters, numbers and dashes only')
    .min(2)
    .max(max);
const statusSchema = z.enum(['active', 'inactive']);
const optionalPhone = z
  .union([z.literal(''), nigerianPhoneSchema])
  .transform((v) => (v === '' ? null : v))
  .nullish();

const atLeastOneChange = (v: Record<string, unknown>) => Object.keys(v).some((k) => k !== 'version' && v[k] !== undefined);

// ── Organisations ─────────────────────────────────────────────────────────────
export const createOrganisationSchema = z.object({
  name: name(160),
  code: code(20),
  state: place,
  contactEmail: z.union([z.literal(''), emailSchema]).transform((v) => (v === '' ? null : v)).nullish(),
});
export type CreateOrganisationInput = z.infer<typeof createOrganisationSchema>;

export const updateOrganisationSchema = z
  .object({
    name: name(160).optional(),
    state: place.optional(),
    contactEmail: createOrganisationSchema.shape.contactEmail,
    status: statusSchema.optional(),
    version: versionSchema,
  })
  .refine(atLeastOneChange, 'Nothing to update');
export type UpdateOrganisationInput = z.infer<typeof updateOrganisationSchema>;

// ── Facilities ────────────────────────────────────────────────────────────────
export const createFacilitySchema = z.object({
  organisationId: objectIdSchema.nullish(),
  name: name(160),
  code: code(30),
  type: z.enum(FACILITY_TYPES).default('phc'),
  lga: place,
  ward: optionalText(80),
  address: optionalText(240),
  phone: optionalPhone,
});
export type CreateFacilityInput = z.infer<typeof createFacilitySchema>;

export const updateFacilitySchema = z
  .object({
    name: name(160).optional(),
    type: z.enum(FACILITY_TYPES).optional(),
    lga: place.optional(),
    ward: optionalText(80),
    address: optionalText(240),
    phone: optionalPhone,
    status: statusSchema.optional(),
    version: versionSchema,
  })
  .refine(atLeastOneChange, 'Nothing to update');
export type UpdateFacilityInput = z.infer<typeof updateFacilitySchema>;

// ── Communities ───────────────────────────────────────────────────────────────
export const createCommunitySchema = z.object({
  organisationId: objectIdSchema.nullish(),
  name: name(120),
  lga: place,
  ward: optionalText(80),
});
export type CreateCommunityInput = z.infer<typeof createCommunitySchema>;

export const updateCommunitySchema = z
  .object({
    name: name(120).optional(),
    lga: place.optional(),
    ward: optionalText(80),
    status: statusSchema.optional(),
    version: versionSchema,
  })
  .refine(atLeastOneChange, 'Nothing to update');
export type UpdateCommunityInput = z.infer<typeof updateCommunitySchema>;
