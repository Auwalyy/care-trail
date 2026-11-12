/**
 * DEVELOPMENT ONLY: creates clearly-labelled demo data so the apps can be tried out. Creates no
 * patient data. Refuses to run in production. Idempotent.
 *
 *   npm run seed:dev -w @caretrail/api                      reference data only
 *   npm run seed:dev -w @caretrail/api -- --with-users      also demo sign-in accounts
 *
 * Demo accounts use SEED_DEMO_PASSWORD if set (min 10 characters), otherwise a random password
 * that is printed once. Existing demo accounts keep their password unless SEED_DEMO_PASSWORD is
 * given. Emails use the reserved .test domain, so they can never reach a real inbox.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Types } from 'mongoose';
import type { Role } from '@caretrail/shared-types';
import { passwordSchema } from '@caretrail/validation';
import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { PasswordHasher } from '../modules/auth/password-hasher.js';
import { ChwProfileModel } from '../modules/chws/chw.model.js';
import { CommunityModel } from '../modules/communities/community.model.js';
import { FacilityModel } from '../modules/facilities/facility.model.js';
import { OrganisationModel } from '../modules/organisations/organisation.model.js';
import { ProgrammeSettingsModel } from '../modules/settings/settings.model.js';
import { UserModel } from '../modules/users/user.model.js';
import { createLogger } from '../utils/logger.js';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main() {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    console.error('seed:dev refuses to run with NODE_ENV=production.');
    process.exit(1);
  }
  const withUsers = process.argv.includes('--with-users');
  await connectDatabase({ uri: env.MONGODB_URI, logger: createLogger({ level: 'warn' }) });
  try {
    const org = await OrganisationModel.findOneAndUpdate(
      { code: 'DEMO' },
      { $setOnInsert: { name: 'DEMO Programme (not real)', code: 'DEMO', state: 'Kano' } },
      { upsert: true, returnDocument: 'after' },
    );
    const facilities: Types.ObjectId[] = [];
    for (const f of [
      { code: 'DEMO-PHC-1', name: 'DEMO Primary Health Centre 1', lga: 'Demo LGA A' },
      { code: 'DEMO-PHC-2', name: 'DEMO Primary Health Centre 2', lga: 'Demo LGA B' },
    ]) {
      const doc = await FacilityModel.findOneAndUpdate({ organisationId: org._id, code: f.code }, { $setOnInsert: { ...f, organisationId: org._id, type: 'phc' } }, { upsert: true, returnDocument: 'after' });
      facilities.push(doc._id);
    }
    const communities: Types.ObjectId[] = [];
    for (const c of [
      { name: 'DEMO Community 1', lga: 'Demo LGA A' },
      { name: 'DEMO Community 2', lga: 'Demo LGA B' },
    ]) {
      const doc = await CommunityModel.findOneAndUpdate({ organisationId: org._id, lga: c.lga, name: c.name }, { $setOnInsert: { ...c, organisationId: org._id } }, { upsert: true, returnDocument: 'after' });
      communities.push(doc._id);
    }
    // A consent wording reference so CHWs can register demo patients (not a real consent text).
    await ProgrammeSettingsModel.updateOne(
      { organisationId: org._id },
      { $setOnInsert: { organisationId: org._id, referralExpectedArrivalDays: 7, appointmentOverdueGraceDays: 1, offlineSessionGraceDays: 14, consentTextVersion: 'DEMO-NOT-REAL-v1', version: 1 } },
      { upsert: true },
    );
    console.log('Demo reference data ready: organisation DEMO, 2 facilities, 2 communities, programme settings.');

    if (withUsers) await seedUsers(org._id, facilities, communities);
  } finally {
    await disconnectDatabase();
  }
}

async function seedUsers(organisationId: Types.ObjectId, facilities: Types.ObjectId[], communities: Types.ObjectId[]) {
  const given = process.env.SEED_DEMO_PASSWORD;
  if (given && !passwordSchema.safeParse(given).success) throw new Error('SEED_DEMO_PASSWORD does not meet the password rules (at least 10 characters).');
  const password = given ?? `demo-${randomBytes(6).toString('hex')}`;
  const passwordHash = await new PasswordHasher().hash(password);

  const accounts: { email: string; fullName: string; role: Role; extra: Record<string, unknown> }[] = [
    { email: 'platform.demo@caretrail.test', fullName: 'DEMO Platform Admin', role: 'platform_admin', extra: {} },
    { email: 'programme.demo@caretrail.test', fullName: 'DEMO Programme Admin', role: 'programme_admin', extra: { organisationId } },
    { email: 'facility.demo@caretrail.test', fullName: 'DEMO Facility Admin', role: 'facility_admin', extra: { organisationId, facilityId: facilities[0] } },
    { email: 'nurse.demo@caretrail.test', fullName: 'DEMO Nurse', role: 'facility_worker', extra: { organisationId, facilityId: facilities[0] } },
    { email: 'chw.demo@caretrail.test', fullName: 'DEMO Health Worker', role: 'chw', extra: { organisationId, communityIds: communities } },
  ];
  const created: string[] = [];
  const ids = new Map<Role, Types.ObjectId>();
  for (const a of accounts) {
    const existing = await UserModel.findOne({ email: a.email }).select('_id').lean();
    if (existing) {
      if (given) await UserModel.updateOne({ _id: existing._id }, { $set: { passwordHash, passwordChangedAt: new Date(), status: 'active' } });
      ids.set(a.role, existing._id);
      continue;
    }
    const user = await UserModel.create({ email: a.email, fullName: a.fullName, role: a.role, status: 'active', passwordHash, passwordChangedAt: new Date(), ...a.extra });
    ids.set(a.role, user._id);
    created.push(a.email);
  }
  await ChwProfileModel.updateOne(
    { userId: ids.get('chw') },
    { $setOnInsert: { userId: ids.get('chw'), organisationId, canIssueReferrals: true, supervisorUserId: ids.get('facility_worker') } },
    { upsert: true },
  );

  console.log('\nDemo accounts (development only):');
  for (const a of accounts) console.log(`  ${a.role.padEnd(16)} ${a.email}`);
  if (created.length || given) {
    console.log(`\n  Password for ${given ? 'all demo accounts' : 'the accounts created now'}: ${password}`);
    if (!given) console.log('  It is shown only once. Re-run with SEED_DEMO_PASSWORD=... to set a new one.');
  } else {
    console.log('\n  All demo accounts already existed; passwords unchanged. Set SEED_DEMO_PASSWORD to reset them.');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
