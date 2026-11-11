import { describe, expect, it } from 'vitest';
import { ageInYears, birthYearOf, nameKey } from './patients.js';

describe('nameKey', () => {
  it('ignores case, spacing, punctuation, accents and word order', () => {
    const k = nameKey('Aisha Musa');
    expect(nameKey('  musa   AISHA ')).toBe(k);
    expect(nameKey('Musa, Aïsha')).toBe(k);
    expect(nameKey("A'isha Musa")).toBe(k);
  });
  it('keeps different names apart', () => {
    expect(nameKey('Aisha Musa')).not.toBe(nameKey('Aisha Musa Bello'));
  });
});

describe('ages', () => {
  it('uses the exact date of birth when known', () => {
    expect(ageInYears({ dateOfBirth: '2000-06-15', estimatedBirthYear: null }, '2026-06-14')).toBe(25);
    expect(ageInYears({ dateOfBirth: '2000-06-15', estimatedBirthYear: null }, '2026-06-15')).toBe(26);
    expect(birthYearOf({ dateOfBirth: '2000-06-15', estimatedBirthYear: null })).toBe(2000);
  });
  it('falls back to the estimated birth year', () => {
    expect(ageInYears({ dateOfBirth: null, estimatedBirthYear: 2001 }, '2026-01-01')).toBe(25);
    expect(birthYearOf({ dateOfBirth: null, estimatedBirthYear: 2001 })).toBe(2001);
    expect(ageInYears({ dateOfBirth: null, estimatedBirthYear: null }, '2026-01-01')).toBeNull();
  });
});
