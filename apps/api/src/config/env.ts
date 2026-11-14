import { z } from 'zod';

/** Hosting dashboards make it easy to paste a stray space, quotes or a trailing slash. */
const cleanUrl = (v: string) => v.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((v) =>
        v
          .split(',')
          .map(cleanUrl)
          .filter(Boolean),
      ),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must be a mongodb:// URI'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    JWT_ISSUER: z.string().default('caretrail-api'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /** Public URL of the web app — used to build activation and password-reset links. */
    WEB_APP_URL: z.string().default('http://localhost:3000').transform(cleanUrl).pipe(z.url()),
    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    REDIS_URL: z.string().optional(),
    API_DOCS_ENABLED: booleanString.default(true),
    /** How often the missed-care check runs in this process. 0 disables it (e.g. on extra replicas). */
    MISSED_CARE_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(15),
    /** How often queued notifications are sent and reminders planned. 0 disables it in this process. */
    NOTIFICATION_DISPATCH_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
    /**
     * SMS / voice delivery. `none` records messages as "not sent: no provider". `log` writes a
     * line without phone number or text and counts as sent: development only. A real provider
     * (e.g. a Nigerian SMS aggregator) is added as a NotificationProvider once contracted.
     */
    SMS_PROVIDER: z.enum(['none', 'log']).default('none'),
    VOICE_PROVIDER: z.enum(['none', 'log']).default('none'),
    /** Uploaded files (education audio). */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    /** For S3-compatible services (MinIO, DigitalOcean Spaces…). */
    S3_ENDPOINT: z.url().optional(),
    APP_VERSION: z.string().default('0.1.0'),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      if (!env.S3_BUCKET) ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'S3_BUCKET is required when STORAGE_DRIVER=s3' });
      if (!env.S3_REGION) ctx.addIssue({ code: 'custom', path: ['S3_REGION'], message: 'S3_REGION is required when STORAGE_DRIVER=s3' });
    }
    if (env.NODE_ENV === 'production') {
      for (const key of ['SMS_PROVIDER', 'VOICE_PROVIDER'] as const) {
        if (env[key] === 'log') ctx.addIssue({ code: 'custom', path: [key], message: `${key}=log only pretends to send; it is not allowed in production` });
      }
      if (!env.WEB_APP_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_APP_URL'],
          message: `WEB_APP_URL must start with https:// in production (reset links carry secrets); got "${env.WEB_APP_URL}"`,
        });
      }
      if (env.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'Wildcard CORS origin is not allowed in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/** Parse and validate environment variables. Never logs secret values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}
