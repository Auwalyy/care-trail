import { z } from 'zod';
import { LANGUAGES, ROLES, USER_STATUSES } from '@caretrail/shared-types';
import { nigerianPhoneSchema, objectIdSchema, versionSchema } from './common.js';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254));

/**
 * Password policy (NIST SP 800-63B style): length over composition rules. 10–128 characters, not
 * a trivially repeated or sequential string. Breached-password screening can be added later.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((v) => !/^(.)\1+$/.test(v), 'Password cannot be one repeated character')
  .refine(
    (v) => !['0123456789', '1234567890', 'abcdefghij', 'password12', 'caretrail1'].some((w) => v.toLowerCase().includes(w)),
    'Password is too easy to guess',
  );

export const loginSchema = z.object({
  email: emailSchema,
  // Do not apply the policy on login — old passwords must still be accepted for verification.
  password: z.string().min(1, 'Enter your password').max(128),
  client: z.enum(['web', 'mobile']).default('web'),
  deviceId: z.string().trim().min(8).max(100).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200).optional(),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(200).optional(),
  allDevices: z.boolean().default(false),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must be different',
    path: ['newPassword'],
  });

const userBase = {
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  phone: nigerianPhoneSchema.nullish(),
  preferredLanguage: z.enum(LANGUAGES).default('en'),
};

export const createUserSchema = z.object({
  ...userBase,
  email: emailSchema,
  role: z.enum(ROLES),
  organisationId: objectIdSchema.nullish(),
  facilityId: objectIdSchema.nullish(),
  communityIds: z.array(objectIdSchema).max(20).default([]),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: userBase.fullName.optional(),
    phone: userBase.phone,
    preferredLanguage: z.enum(LANGUAGES).optional(),
    facilityId: objectIdSchema.nullish(),
    communityIds: z.array(objectIdSchema).max(20).optional(),
    version: versionSchema,
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update');
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const setUserStatusSchema = z.object({
  status: z.enum(USER_STATUSES).exclude(['pending_activation']),
  version: versionSchema,
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['fullName', '-fullName', 'createdAt', '-createdAt', 'lastLoginAt', '-lastLoginAt']).default('fullName'),
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  organisationId: objectIdSchema.optional(),
  facilityId: objectIdSchema.optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
