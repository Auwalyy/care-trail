import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, hasPermission } from './permissions.js';
import { ROLES } from './roles.js';

describe('role permissions', () => {
  it('only references known permissions', () => {
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it('keeps clinical referral actions with facility staff only', () => {
    expect(hasPermission('chw', 'referral:update-status')).toBe(false);
    expect(hasPermission('chw', 'referral:set-priority')).toBe(false);
    expect(hasPermission('programme_admin', 'referral:update-status')).toBe(false);
    expect(hasPermission('facility_worker', 'referral:update-status')).toBe(true);
  });

  it('restricts content approval and organisation management to platform admins', () => {
    for (const role of ROLES) {
      const expected = role === 'platform_admin';
      expect(hasPermission(role, 'education:approve')).toBe(expected);
      expect(hasPermission(role, 'organisation:manage')).toBe(expected);
    }
  });

  it('gives sync access only to CHWs', () => {
    expect(ROLES.filter((r) => hasPermission(r, 'sync:use'))).toEqual(['chw']);
  });
});
