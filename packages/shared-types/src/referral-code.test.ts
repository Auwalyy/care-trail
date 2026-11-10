import { describe, expect, it } from 'vitest';
import {
  CROCKFORD_ALPHABET,
  buildReferralCode,
  isValidReferralCode,
  normaliseReferralCode,
} from './referral-code.js';

function randomBody(): string {
  let s = '';
  for (let i = 0; i < 7; i++) s += CROCKFORD_ALPHABET[Math.floor(Math.random() * 32)];
  return s;
}

describe('referral codes', () => {
  it('builds codes in CT-XXXX-XXXX form that validate', () => {
    for (let i = 0; i < 500; i++) {
      const code = buildReferralCode(randomBody());
      expect(code).toMatch(/^CT-.{4}-.{4}$/);
      expect(isValidReferralCode(code)).toBe(true);
    }
  });

  it('accepts sloppy input: lower case, spaces, missing dashes and prefix', () => {
    const code = buildReferralCode('7K3M9QX');
    const sloppy = code.toLowerCase().replace(/-/g, ' ').replace('ct ', '');
    expect(normaliseReferralCode(sloppy)).toBe(code);
    expect(isValidReferralCode(sloppy)).toBe(true);
  });

  it('maps O→0 and I/L→1 in the body', () => {
    const code = buildReferralCode('10A0B1C');
    expect(isValidReferralCode(code.replace('10A0', 'IOAO'))).toBe(true);
  });

  it('detects every single-character substitution', () => {
    const code = buildReferralCode('4F7H2KD');
    const chars = code.slice(3).replace('-', '');
    for (let pos = 0; pos < 7; pos++) {
      for (const replacement of CROCKFORD_ALPHABET) {
        if (replacement === chars[pos]) continue;
        const mutated = chars.slice(0, pos) + replacement + chars.slice(pos + 1);
        expect(isValidReferralCode(mutated)).toBe(false);
      }
    }
  });

  it('detects adjacent transpositions of different characters', () => {
    const code = buildReferralCode('ABCDEFG');
    const chars = code.slice(3).replace('-', '');
    for (let pos = 0; pos < 6; pos++) {
      const swapped = chars.slice(0, pos) + chars[pos + 1] + chars[pos] + chars.slice(pos + 2);
      expect(isValidReferralCode(swapped)).toBe(false);
    }
  });

  it('rejects malformed input', () => {
    expect(isValidReferralCode('')).toBe(false);
    expect(isValidReferralCode('CT-1234')).toBe(false);
    expect(isValidReferralCode('CT-1234-56789')).toBe(false);
    expect(() => buildReferralCode('ABC')).toThrow();
    expect(() => buildReferralCode('ABCDEFU')).toThrow();
  });
});
