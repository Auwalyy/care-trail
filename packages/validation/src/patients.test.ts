import { describe, expect, it } from 'vitest';
import { pathwayIssues, registerPatientSchema, todayIso } from './patients.js';

const plusDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

const base = {
  fullName: 'Aisha Musa',
  sex: 'female',
  estimatedAge: 24,
  communityId: '507f1f77bcf86cd799439011',
  carePathway: 'antenatal',
  pathwayDetails: { expectedDeliveryDate: plusDays(120) },
  consent: {
    purposes: { care_coordination: true, sms: false, voice: false, facility_sharing: true },
    method: 'verbal',
    consentTextVersion: 'KN-2026-v1',
    language: 'ha',
  },
};

const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join('.'));

describe('registerPatientSchema', () => {
  it('accepts a minimal antenatal registration and applies defaults', () => {
    const r = registerPatientSchema.parse(base);
    expect(r).toMatchObject({ preferredLanguage: 'ha', preferredChannel: 'none', phoneOwner: 'none', household: { mode: 'none' }, dateOfBirth: null });
    expect(r.pathwayDetails).toEqual({ expectedDeliveryDate: base.pathwayDetails.expectedDeliveryDate, deliveryDate: null, motherPatientId: null });
  });

  it('requires consent to care coordination', () => {
    const r = registerPatientSchema.safeParse({ ...base, consent: { ...base.consent, purposes: { ...base.consent.purposes, care_coordination: false } } });
    expect(paths(r)).toContain('consent.purposes.care_coordination');
  });

  it('requires exactly one of date of birth or estimated age', () => {
    expect(paths(registerPatientSchema.safeParse({ ...base, estimatedAge: undefined }))).toContain('dateOfBirth');
    expect(paths(registerPatientSchema.safeParse({ ...base, dateOfBirth: '2000-01-01' }))).toContain('dateOfBirth');
    expect(paths(registerPatientSchema.safeParse({ ...base, estimatedAge: undefined, dateOfBirth: plusDays(3) }))).toContain('dateOfBirth');
  });

  it('only allows reminder channels the patient consented to, with a phone number', () => {
    expect(paths(registerPatientSchema.safeParse({ ...base, preferredChannel: 'sms', phone: '08031234567' }))).toContain('preferredChannel');
    const ok = { ...base, preferredChannel: 'sms', consent: { ...base.consent, purposes: { ...base.consent.purposes, sms: true } } };
    expect(paths(registerPatientSchema.safeParse(ok))).toContain('phone');
    expect(registerPatientSchema.safeParse({ ...ok, phone: '08031234567' }).success).toBe(true);
  });

  it('drops pathway details that do not belong to the pathway', () => {
    const r = registerPatientSchema.parse({ ...base, pathwayDetails: { ...base.pathwayDetails, deliveryDate: '2026-01-01' } });
    expect(r.pathwayDetails.deliveryDate).toBeNull();
  });
});

describe('pathwayIssues', () => {
  const today = todayIso();
  it('checks pathway-specific dates and sex', () => {
    expect(pathwayIssues({ carePathway: 'antenatal', sex: 'male', dateOfBirth: null, expectedDeliveryDate: plusDays(30), deliveryDate: null }, today).map((i) => i.path)).toEqual(['sex']);
    expect(pathwayIssues({ carePathway: 'antenatal', sex: 'female', dateOfBirth: null, expectedDeliveryDate: plusDays(400), deliveryDate: null }, today)).toHaveLength(1);
    expect(pathwayIssues({ carePathway: 'postnatal', sex: 'female', dateOfBirth: null, expectedDeliveryDate: null, deliveryDate: plusDays(2) }, today)).toHaveLength(1);
    expect(pathwayIssues({ carePathway: 'newborn', sex: 'male', dateOfBirth: plusDays(-10), expectedDeliveryDate: null, deliveryDate: null }, today)).toEqual([]);
    expect(pathwayIssues({ carePathway: 'newborn', sex: 'male', dateOfBirth: plusDays(-500), expectedDeliveryDate: null, deliveryDate: null }, today)).toHaveLength(1);
    expect(pathwayIssues({ carePathway: 'caregiver', sex: 'male', dateOfBirth: null, expectedDeliveryDate: null, deliveryDate: null }, today)).toEqual([]);
  });
});
