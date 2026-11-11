import {
  Building2,
  HeartHandshake,
  Hospital,
  LayoutDashboard,
  MapPinned,
  ScrollText,
  Settings2,
  UserCircle2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Permission, Role } from '@caretrail/shared-types';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only if the user has this permission. */
  permission?: Permission;
  /** Hidden for these roles (e.g. CHWs work in the mobile app). */
  hiddenFor?: Role[];
  group: 'main' | 'administration' | 'account';
}

/**
 * Only features that exist are listed — modules join the menu in the phase that builds them
 * (patients, referrals, follow-ups, …), so nobody lands on a placeholder page.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, hiddenFor: ['chw'], group: 'main' },
  { href: '/chws', label: 'Health workers', icon: HeartHandshake, permission: 'chw:read', group: 'main' },
  { href: '/facilities', label: 'Facilities', icon: Hospital, permission: 'facility:read', hiddenFor: ['chw'], group: 'main' },
  { href: '/communities', label: 'Communities', icon: MapPinned, permission: 'community:read', hiddenFor: ['chw'], group: 'main' },
  { href: '/users', label: 'Users', icon: Users, permission: 'user:read', group: 'administration' },
  { href: '/organisations', label: 'Organisations', icon: Building2, permission: 'organisation:manage', group: 'administration' },
  { href: '/settings', label: 'Programme settings', icon: Settings2, permission: 'settings:manage', group: 'administration' },
  { href: '/audit-logs', label: 'Audit log', icon: ScrollText, permission: 'audit:read', group: 'administration' },
  { href: '/profile', label: 'My profile', icon: UserCircle2, group: 'account' },
];

export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  chws: 'Health workers',
  facilities: 'Facilities',
  communities: 'Communities',
  users: 'Users',
  organisations: 'Organisations',
  settings: 'Programme settings',
  'audit-logs': 'Audit log',
  profile: 'My profile',
};

export function visibleNavItems(role: Role, permissions: readonly Permission[]): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.hiddenFor?.includes(role) && (!item.permission || permissions.includes(item.permission)),
  );
}
