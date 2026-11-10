import { describe, expect, it } from 'vitest';
import {
  REFERRAL_STATUSES,
  REFERRAL_TRANSITIONS,
  TERMINAL_REFERRAL_STATUSES,
  availableReferralTransitions,
  checkReferralTransition,
} from './referral.js';

describe('referral state machine', () => {
  it('follows the happy path issued → arrived → service recorded → completed for facility staff', () => {
    expect(checkReferralTransition('issued', 'patient_arrived', 'facility_worker').allowed).toBe(true);
    expect(checkReferralTransition('patient_arrived', 'service_recorded', 'facility_worker').allowed).toBe(true);
    expect(checkReferralTransition('service_recorded', 'completed', 'facility_admin').allowed).toBe(true);
  });

  it('allows the further-follow-up outcome only with a note', () => {
    expect(checkReferralTransition('service_recorded', 'follow_up_required', 'facility_worker')).toEqual({
      allowed: false,
      reason: 'note_required',
    });
    expect(
      checkReferralTransition('service_recorded', 'follow_up_required', 'facility_worker', 'Review in 1 week')
        .allowed,
    ).toBe(true);
  });

  it('never lets a CHW confirm arrival or complete a referral', () => {
    expect(checkReferralTransition('issued', 'patient_arrived', 'chw').reason).toBe('actor_not_permitted');
    expect(checkReferralTransition('service_recorded', 'completed', 'chw').reason).toBe('actor_not_permitted');
  });

  it('rejects skipping steps', () => {
    expect(checkReferralTransition('issued', 'completed', 'facility_worker').reason).toBe('invalid_transition');
    expect(checkReferralTransition('issued', 'service_recorded', 'facility_admin').reason).toBe(
      'invalid_transition',
    );
  });

  it('allows cancellation only before arrival and only with a reason', () => {
    expect(checkReferralTransition('issued', 'cancelled', 'chw').reason).toBe('note_required');
    expect(checkReferralTransition('issued', 'cancelled', 'chw', 'Patient relocated').allowed).toBe(true);
    expect(checkReferralTransition('patient_arrived', 'cancelled', 'programme_admin', 'x').reason).toBe(
      'invalid_transition',
    );
  });

  it('reserves expiry for the system', () => {
    expect(checkReferralTransition('issued', 'expired', 'system').allowed).toBe(true);
    expect(checkReferralTransition('issued', 'expired', 'platform_admin').reason).toBe('actor_not_permitted');
    expect(checkReferralTransition('expired', 'patient_arrived', 'facility_worker').allowed).toBe(true);
  });

  it('has no transitions out of terminal statuses', () => {
    for (const s of TERMINAL_REFERRAL_STATUSES) expect(REFERRAL_TRANSITIONS[s]).toHaveLength(0);
  });

  it('defines rules for every status', () => {
    for (const s of REFERRAL_STATUSES) expect(REFERRAL_TRANSITIONS[s]).toBeDefined();
  });

  it('lists available actions per actor', () => {
    expect(availableReferralTransitions('service_recorded', 'facility_worker').sort()).toEqual([
      'completed',
      'follow_up_required',
    ]);
    expect(availableReferralTransitions('issued', 'chw')).toEqual(['cancelled']);
  });
});
