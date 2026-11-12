import { z } from 'zod';
import {
  CARE_PATHWAYS,
  CONSENT_METHODS,
  CONTACT_CHANNELS,
  LANGUAGES,
  PATIENT_STATUSES,
  PHONE_OWNERS,
  SEXES,
  type CarePathway,
  type Sex,
} from '@caretrail/shared-types';
import { clientIdSchema, nigerianPhoneSchema, objectIdSchema, versionSchema } from './common.js';

/** Today as YYYY-MM-DD (UTC). Date-only strings avoid time-zone drift on devices. */
export const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const isoDate = z.iso.date('Use the format YYYY-MM-DD');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();
const optionalPhone = z
  .union([z.literal(''), nigerianPhoneSchema])
  .transform((v) => (v === '' ? null : v))
  .nullish();

// ── Consent ───────────────────────────────────────────────────────────────────
export const consentInputSchema = z.object({
  purposes: z.object({
    care_coordination: z.boolean(),
    sms: z.boolean(),
    voice: z.boolean(),
    facility_sharing: z.boolean(),
  }),
  method: z.enum(CONSENT_METHODS),
  consentTextVersion: z.string().trim().min(1, 'Enter the consent text version').max(40),
  language: z.enum(LANGUAGES),
  witnessName: optionalText(120),
});
export type ConsentInput = z.infer<typeof consentInputSchema>;

/** At registration, consent to care coordination is mandatory. */
export const registrationConsentSchema = consentInputSchema.refine((c) => c.purposes.care_coordination, {
  message: 'The patient must agree to care coordination before they can be registered',
  path: ['purposes', 'care_coordination'],
});

export const recordConsentSchema = consentInputSchema.extend({ version: versionSchema });

// ── Care pathway rules (coordination dates only — no clinical data) ─────────────
export interface PathwayFacts {
  carePathway: CarePathway;
  sex: Sex;
  dateOfBirth: string | null;
  expectedDeliveryDate: string | null;
  deliveryDate: string | null;
}

/** Field-level problems with a pathway combination. Shared by the schema and the API service. */
export function pathwayIssues(p: PathwayFacts, today = todayIso()): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if ((p.carePathway === 'antenatal' || p.carePathway === 'postnatal') && p.sex !== 'female') {
    issues.push({ path: 'sex', message: 'Antenatal and postnatal pathways are for women' });
  }
  if (p.carePathway === 'antenatal') {
    if (!p.expectedDeliveryDate) issues.push({ path: 'pathwayDetails.expectedDeliveryDate', message: 'Enter the expected delivery date' });
    else if (p.expectedDeliveryDate < addDays(today, -60) || p.expectedDeliveryDate > addDays(today, 300)) {
      issues.push({ path: 'pathwayDetails.expectedDeliveryDate', message: 'Expected delivery date must be within the next 10 months' });
    }
  }
  if (p.carePathway === 'postnatal') {
    if (!p.deliveryDate) issues.push({ path: 'pathwayDetails.deliveryDate', message: 'Enter the delivery date' });
    else if (p.deliveryDate > today || p.deliveryDate < addDays(today, -365)) {
      issues.push({ path: 'pathwayDetails.deliveryDate', message: 'Delivery date must be within the past year' });
    }
  }
  if (p.carePathway === 'newborn') {
    if (!p.dateOfBirth) issues.push({ path: 'dateOfBirth', message: "Enter the baby's date of birth" });
    else if (p.dateOfBirth < addDays(today, -365)) issues.push({ path: 'dateOfBirth', message: 'The newborn pathway is for babies under one year' });
  }
  return issues;
}

const pathwayDetailsSchema = z
  .object({
    expectedDeliveryDate: isoDate.nullish(),
    deliveryDate: isoDate.nullish(),
    motherPatientId: objectIdSchema.nullish(),
  })
  .default({});

/** Keeps only the details relevant to the pathway. */
function relevantDetails(pathway: CarePathway, d: z.infer<typeof pathwayDetailsSchema>) {
  return {
    expectedDeliveryDate: pathway === 'antenatal' ? (d.expectedDeliveryDate ?? null) : null,
    deliveryDate: pathway === 'postnatal' ? (d.deliveryDate ?? null) : null,
    motherPatientId: pathway === 'newborn' ? (d.motherPatientId ?? null) : null,
  };
}

// ── Registration ───────────────────────────────────────────────────────────────
export const householdChoiceSchema = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('none') }),
    z.object({ mode: z.literal('existing'), householdId: objectIdSchema }),
    z.object({ mode: z.literal('new'), headName: optionalText(120), landmark: optionalText(200), phone: optionalPhone }),
  ])
  .default({ mode: 'none' });

const fullName = z.string().trim().min(2, 'Enter the full name').max(120);
const dateOfBirth = isoDate.refine((d) => d <= todayIso() && d >= '1900-01-01', 'Date of birth cannot be in the future');
const estimatedAge = z.number().int().min(0, 'Age cannot be negative').max(100);

export const registerPatientSchema = z
  .object({
    /** Device-generated id: makes retries and offline sync idempotent. */
    clientId: clientIdSchema.optional(),
    fullName,
    sex: z.enum(SEXES),
    dateOfBirth: dateOfBirth.nullish(),
    estimatedAge: estimatedAge.nullish(),
    phone: optionalPhone,
    alternatePhone: optionalPhone,
    phoneOwner: z.enum(PHONE_OWNERS).default('self'),
    communityId: objectIdSchema,
    household: householdChoiceSchema,
    carePathway: z.enum(CARE_PATHWAYS),
    pathwayDetails: pathwayDetailsSchema,
    preferredLanguage: z.enum(LANGUAGES).default('ha'),
    preferredChannel: z.enum(CONTACT_CHANNELS).default('none'),
    /** Admins choose; CHWs are always assigned to themselves. */
    assignedChwId: objectIdSchema.nullish(),
    organisationId: objectIdSchema.nullish(),
    /** Set after reviewing a POSSIBLE_DUPLICATE response. */
    confirmNotDuplicate: z.boolean().default(false),
    consent: registrationConsentSchema,
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.dateOfBirth) === (v.estimatedAge !== null && v.estimatedAge !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Enter either the date of birth or an estimated age' });
    }
    for (const i of pathwayIssues({
      carePathway: v.carePathway,
      sex: v.sex,
      dateOfBirth: v.dateOfBirth ?? null,
      expectedDeliveryDate: v.pathwayDetails.expectedDeliveryDate ?? null,
      deliveryDate: v.pathwayDetails.deliveryDate ?? null,
    })) {
      ctx.addIssue({ code: 'custom', path: i.path.split('.'), message: i.message });
    }
    if (v.preferredChannel === 'sms' && !v.consent.purposes.sms) {
      ctx.addIssue({ code: 'custom', path: ['preferredChannel'], message: 'SMS needs the patient’s consent to SMS reminders' });
    }
    if (v.preferredChannel === 'voice' && !v.consent.purposes.voice) {
      ctx.addIssue({ code: 'custom', path: ['preferredChannel'], message: 'Voice calls need the patient’s consent to voice reminders' });
    }
    if (v.preferredChannel !== 'none' && !v.phone) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'A phone number is needed for reminders' });
    }
  })
  .transform((v) => ({
    ...v,
    dateOfBirth: v.dateOfBirth ?? null,
    estimatedAge: v.dateOfBirth ? null : (v.estimatedAge ?? null),
    phoneOwner: v.phone ? v.phoneOwner : ('none' as const),
    pathwayDetails: relevantDetails(v.carePathway, v.pathwayDetails),
  }));
export type RegisterPatientInput = z.infer<typeof registerPatientSchema>;

// ── Updates ─────────────────────────────────────────────────────────────────────
export const updatePatientSchema = z
  .object({
    fullName: fullName.optional(),
    sex: z.enum(SEXES).optional(),
    dateOfBirth: dateOfBirth.nullish(),
    estimatedAge: estimatedAge.nullish(),
    phone: optionalPhone,
    alternatePhone: optionalPhone,
    phoneOwner: z.enum(PHONE_OWNERS).optional(),
    communityId: objectIdSchema.optional(),
    householdId: objectIdSchema.nullish(),
    carePathway: z.enum(CARE_PATHWAYS).optional(),
    pathwayDetails: z
      .object({ expectedDeliveryDate: isoDate.nullish(), deliveryDate: isoDate.nullish(), motherPatientId: objectIdSchema.nullish() })
      .optional(),
    preferredLanguage: z.enum(LANGUAGES).optional(),
    preferredChannel: z.enum(CONTACT_CHANNELS).optional(),
    version: versionSchema,
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update')
  .refine((v) => !(v.dateOfBirth && v.estimatedAge !== undefined && v.estimatedAge !== null), {
    message: 'Enter either the date of birth or an estimated age',
    path: ['dateOfBirth'],
  });
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

export const setPatientStatusSchema = z
  .object({
    status: z.enum(PATIENT_STATUSES),
    reason: optionalText(300),
    version: versionSchema,
  })
  .refine((v) => v.status === 'active' || Boolean(v.reason), { message: 'Give a reason for this change', path: ['reason'] });

export const reassignPatientSchema = z.object({ assignedChwId: objectIdSchema, version: versionSchema });

export const listPatientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['fullName', '-fullName', 'createdAt', '-createdAt', 'patientCode', '-patientCode']).default('-createdAt'),
  q: z.string().trim().max(100).optional(),
  communityId: objectIdSchema.optional(),
  assignedChwId: objectIdSchema.optional(),
  carePathway: z.enum(CARE_PATHWAYS).optional(),
  status: z.enum(PATIENT_STATUSES).optional(),
  possibleDuplicate: z.enum(['true']).optional(),
  organisationId: objectIdSchema.optional(),
});
export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;

// ── Households ──────────────────────────────────────────────────────────────────
export const createHouseholdSchema = z.object({
  clientId: clientIdSchema.optional(),
  communityId: objectIdSchema,
  headName: optionalText(120),
  landmark: optionalText(200),
  phone: optionalPhone,
});
export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;

export const updateHouseholdSchema = z
  .object({ headName: optionalText(120), landmark: optionalText(200), phone: optionalPhone, version: versionSchema })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update');
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;

export const listHouseholdsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(100).optional(),
  communityId: objectIdSchema.optional(),
  organisationId: objectIdSchema.optional(),
});
export type ListHouseholdsQuery = z.infer<typeof listHouseholdsQuerySchema>;
