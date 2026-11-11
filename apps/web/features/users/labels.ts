import type { Language, UserStatus } from '@caretrail/shared-types';

export const STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Active',
  inactive: 'Deactivated',
  pending_activation: 'Awaiting activation',
};

export const STATUS_BADGE: Record<UserStatus, string> = {
  active: 'bg-success-50 text-success-700 border-success-700/20',
  inactive: 'bg-muted text-ink-muted border-border',
  pending_activation: 'bg-warning-50 text-warning-700 border-warning-700/20',
};

export const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', ha: 'Hausa' };

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
