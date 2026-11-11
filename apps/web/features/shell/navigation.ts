import { LayoutDashboard, UserCircle2, Users, type LucideIcon } from 'lucide-react';
import type { Permission, Role } from '@caretrail/shared-types';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only if the user has this permission. */
  permission?: Permission;
  /** Hidden for these roles (e.g. CHWs work in the mobile app). */
  hiddenFor?: Role[];
}

/**
 * Only features that exist are listed — modules join the menu in the phase that builds them
 * (patients, referrals, facilities, …), so nobody lands on a placeholder page.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, hiddenFor: ['chw'] },
  { href: '/users', label: 'Users', icon: Users, permission: 'user:read' },
  { href: '/profile', label: 'My profile', icon: UserCircle2 },
];

export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  users: 'Users',
  profile: 'My profile',
};

export function visibleNavItems(role: Role, permissions: readonly Permission[]): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.hiddenFor?.includes(role) && (!item.permission || permissions.includes(item.permission)),
  );
}
