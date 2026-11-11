/** Plain-language descriptions of audit actions. Unknown actions fall back to their code. */
export const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.logout_all': 'Signed out of all devices',
  'auth.lockout': 'Sign-in paused after repeated failures',
  'auth.refresh_reuse': 'Suspicious session reuse — all sessions revoked',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.password_reset': 'Password reset',
  'auth.password_changed': 'Password changed',
  'auth.account_activated': 'Account activated',
  'user.create': 'User account created',
  'user.update': 'User account updated',
  'user.deactivate': 'User account deactivated',
  'user.reactivate': 'User account reactivated',
  'user.password_link_issued': 'Activation / reset link issued',
  'chw.update': 'Health worker profile updated',
  'organisation.create': 'Organisation created',
  'organisation.update': 'Organisation updated',
  'organisation.deactivate': 'Organisation deactivated',
  'facility.create': 'Facility registered',
  'facility.update': 'Facility updated',
  'facility.deactivate': 'Facility deactivated',
  'community.create': 'Community added',
  'community.update': 'Community updated',
  'community.deactivate': 'Community deactivated',
  'settings.update': 'Programme settings changed',
};

export const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: 'auth.', label: 'Sign-in & security' },
  { value: 'user.', label: 'User accounts' },
  { value: 'chw.', label: 'Health worker profiles' },
  { value: 'organisation.', label: 'Organisations' },
  { value: 'facility.', label: 'Facilities' },
  { value: 'community.', label: 'Communities' },
  { value: 'settings.', label: 'Settings' },
];

export function describeAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
