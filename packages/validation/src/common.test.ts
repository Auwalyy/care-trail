import { describe, expect, it } from 'vitest';
import { buildReferralCode } from '@caretrail/shared-types';
import {
  dateRangeQuerySchema,
  nigerianPhoneSchema,
  objectIdSchema,
  paginationQuerySchema,
  referralCodeSchema,
} from './common.js';

describe('nigerianPhoneSchema', () => {
  it.each(['08031234567', '8031234567', '2348031234567', '+2348031234567', '0803 123 4567'])(
    'normalises %s to E.164',
    (input) => {
      expect(nigerianPhoneSchema.parse(input)).toBe('+2348031234567');
    },
  );

  it.each(['12345', '+2341031234567', '0803123456', 'abc'])('rejects %s', (input) => {
    expect(nigerianPhoneSchema.safeParse(input).success).toBe(false);
  });
});

describe('referralCodeSchema', () => {
  it('normalises a valid code', () => {
    const code = buildReferralCode('9XK2M4P');
    expect(referralCodeSchema.parse(code.toLowerCase())).toBe(code);
  });
  it('rejects a mistyped code', () => {
    const code = buildReferralCode('9XK2M4P');
    expect(referralCodeSchema.safeParse(code.replace('9', '8')).success).toBe(false);
  });
});

describe('paginationQuerySchema', () => {
  it('applies defaults and coerces strings', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });
  it('caps page size and rejects injection-y sort fields', () => {
    expect(paginationQuerySchema.safeParse({ pageSize: 1000 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ sort: '$where' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ sort: '-createdAt' }).success).toBe(true);
  });
});

describe('misc', () => {
  it('validates ObjectIds', () => {
    expect(objectIdSchema.safeParse('507f1f77bcf86cd799439011').success).toBe(true);
    expect(objectIdSchema.safeParse('not-an-id').success).toBe(false);
  });
  it('rejects inverted date ranges', () => {
    expect(dateRangeQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success).toBe(false);
  });
});
