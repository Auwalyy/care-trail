import type { Role } from './roles.js';

export const REFERRAL_STATUSES = [
  'issued',
  'patient_arrived',
  'service_recorded',
  'follow_up_required',
  'completed',
  'cancelled',
  'expired',
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const TERMINAL_REFERRAL_STATUSES: readonly ReferralStatus[] = ['completed', 'cancelled'];

export type TransitionActor = Role | 'system';

interface TransitionRule {
  to: ReferralStatus;
  /** Who may perform this transition. Resource scoping is checked separately on the server. */
  actors: readonly TransitionActor[];
  /** A note/reason is mandatory for this transition. */
  requiresNote?: boolean;
}

const FACILITY: readonly Role[] = ['facility_worker', 'facility_admin'];
const ISSUER_SIDE: readonly Role[] = ['chw', 'programme_admin', 'platform_admin'];

/**
 * Closed-loop referral workflow:
 *   issued → patient_arrived → service_recorded → completed
 *                                              ↘ follow_up_required → completed
 * Cancellation is only possible before arrival. Expiry is system-driven when the expected arrival
 * window lapses; an expired referral can still be marked arrived if the patient turns up late.
 */
export const REFERRAL_TRANSITIONS: Record<ReferralStatus, readonly TransitionRule[]> = {
  issued: [
    { to: 'patient_arrived', actors: FACILITY },
    { to: 'cancelled', actors: ISSUER_SIDE, requiresNote: true },
    { to: 'expired', actors: ['system'] },
  ],
  expired: [
    { to: 'patient_arrived', actors: FACILITY },
    { to: 'cancelled', actors: ISSUER_SIDE, requiresNote: true },
  ],
  patient_arrived: [{ to: 'service_recorded', actors: FACILITY }],
  service_recorded: [
    { to: 'completed', actors: FACILITY },
    { to: 'follow_up_required', actors: FACILITY, requiresNote: true },
  ],
  follow_up_required: [{ to: 'completed', actors: FACILITY }],
  completed: [],
  cancelled: [],
};

export interface TransitionCheck {
  allowed: boolean;
  reason?: 'invalid_transition' | 'actor_not_permitted' | 'note_required';
}

export function checkReferralTransition(
  from: ReferralStatus,
  to: ReferralStatus,
  actor: TransitionActor,
  note?: string | null,
): TransitionCheck {
  const rule = REFERRAL_TRANSITIONS[from].find((r) => r.to === to);
  if (!rule) return { allowed: false, reason: 'invalid_transition' };
  if (!rule.actors.includes(actor)) return { allowed: false, reason: 'actor_not_permitted' };
  if (rule.requiresNote && !(note && note.trim().length > 0)) {
    return { allowed: false, reason: 'note_required' };
  }
  return { allowed: true };
}

/** Statuses a given actor may move a referral to from its current status (for UI action lists). */
export function availableReferralTransitions(
  from: ReferralStatus,
  actor: TransitionActor,
): ReferralStatus[] {
  return REFERRAL_TRANSITIONS[from].filter((r) => r.actors.includes(actor)).map((r) => r.to);
}
