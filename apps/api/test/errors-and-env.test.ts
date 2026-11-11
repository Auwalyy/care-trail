import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvValidationError, loadEnv } from '../src/config/env.js';
import { describeMongoUri } from '../src/database/connection.js';
import { normaliseError } from '../src/middleware/error-handler.js';
import { AppError } from '../src/utils/app-error.js';

describe('normaliseError', () => {
  it('passes AppErrors through', () => {
    const e = AppError.forbidden();
    expect(normaliseError(e)).toBe(e);
    expect(e.status).toBe(403);
  });

  it('maps Zod errors to field-level validation details', () => {
    const r = z.object({ phone: z.string() }).safeParse({});
    const e = normaliseError(r.error);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.details).toEqual([{ path: 'phone', message: expect.any(String) }]);
  });

  it('maps duplicate keys to CONFLICT without leaking values', () => {
    const e = normaliseError({ code: 11000, keyPattern: { phone: 1 }, keyValue: { phone: '+2348030000000' } });
    expect(e.code).toBe('CONFLICT');
    expect(JSON.stringify(e.details)).not.toContain('+234');
  });

  it('maps cast errors to validation errors', () => {
    const e = normaliseError(new mongoose.Error.CastError('ObjectId', 'nope', '_id'));
    expect(e.code).toBe('VALIDATION_ERROR');
  });

  it('hides unknown error messages', () => {
    const e = normaliseError(new Error('db password is hunter2'));
    expect(e.code).toBe('INTERNAL_ERROR');
    expect(e.message).not.toContain('hunter2');
  });
});

describe('loadEnv', () => {
  const base = { MONGODB_URI: 'mongodb://localhost/x', JWT_ACCESS_SECRET: 's'.repeat(40) };

  it('applies defaults', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.API_DOCS_ENABLED).toBe(true);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.LOGIN_MAX_FAILED_ATTEMPTS).toBe(5);
  });

  it('requires a MongoDB URI and a strong JWT secret in every environment', () => {
    expect(() => loadEnv({ JWT_ACCESS_SECRET: 's'.repeat(40) })).toThrow(EnvValidationError);
    expect(() => loadEnv({ MONGODB_URI: 'mongodb://localhost/x' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'too-short' })).toThrow(/at least 32/);
  });

  it('requires https links and no wildcard CORS in production', () => {
    try {
      loadEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: '*', WEB_APP_URL: 'http://app.example' });
      expect.unreachable();
    } catch (err) {
      const issues = (err as EnvValidationError).issues.join('\n');
      expect(issues).toContain('WEB_APP_URL');
      expect(issues).toContain('CORS_ORIGINS');
    }
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example', WEB_APP_URL: 'https://app.example' }),
    ).not.toThrow();
  });

  it('never includes secret values in error messages', () => {
    try {
      loadEnv({ ...base, JWT_ACCESS_SECRET: 'short-secret-value' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('short-secret-value');
    }
  });
});

describe('describeMongoUri', () => {
  it('strips credentials', () => {
    expect(describeMongoUri('mongodb://admin:s3cret@db.example:27017/caretrail?replicaSet=rs0')).toBe(
      'mongodb://db.example:27017/caretrail',
    );
  });
});
