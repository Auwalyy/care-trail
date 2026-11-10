export const ROLES = [
  'platform_admin',
  'programme_admin',
  'facility_admin',
  'facility_worker',
  'chw',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: 'Platform Administrator',
  programme_admin: 'Programme Administrator',
  facility_admin: 'Facility Administrator',
  facility_worker: 'Facility Healthcare Worker',
  chw: 'Community Health Worker',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
