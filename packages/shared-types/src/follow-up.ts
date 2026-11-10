export const FOLLOW_UP_STATUSES = [
  'pending',
  'assigned',
  'in_progress',
  'contacted',
  'resolved',
  'escalated',
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_TRANSITIONS: Record<FollowUpStatus, readonly FollowUpStatus[]> = {
  pending: ['assigned', 'in_progress', 'escalated', 'resolved'],
  assigned: ['in_progress', 'contacted', 'escalated', 'resolved'],
  in_progress: ['contacted', 'escalated', 'resolved'],
  contacted: ['in_progress', 'escalated', 'resolved'],
  escalated: ['in_progress', 'resolved'],
  resolved: [],
};

/** Open = still requires work from the responsible CHW (escalated tasks are tracked separately). */
export function isOpenFollowUp(status: FollowUpStatus): boolean {
  return status !== 'resolved' && status !== 'escalated';
}

export function canTransitionFollowUp(from: FollowUpStatus, to: FollowUpStatus): boolean {
  return FOLLOW_UP_TRANSITIONS[from].includes(to);
}
