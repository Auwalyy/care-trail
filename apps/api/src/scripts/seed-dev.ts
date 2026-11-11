/**
 * DEVELOPMENT ONLY: creates clearly-labelled demo reference data (one organisation, two
 * facilities, two communities) so user onboarding can be exercised before the Phase 3
 * administration screens exist. Creates no people and no patient data. Refuses to run in
 * production. Idempotent.
 *
 *   npm run seed:dev -w @caretrail/api
 */
import { existsSync } from 'node:fs';
import { loadEnv } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { CommunityModel } from '../modules/communities/community.model.js';
import { FacilityModel } from '../modules/facilities/facility.model.js';
import { OrganisationModel } from '../modules/organisations/organisation.model.js';
import { createLogger } from '../utils/logger.js';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main() {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    console.error('seed:dev refuses to run with NODE_ENV=production.');
    process.exit(1);
  }
  await connectDatabase({ uri: env.MONGODB_URI, logger: createLogger({ level: 'warn' }) });
  try {
    const org = await OrganisationModel.findOneAndUpdate(
      { code: 'DEMO' },
      { $setOnInsert: { name: 'DEMO Programme (not real)', code: 'DEMO', state: 'Kano' } },
      { upsert: true, returnDocument: 'after' },
    );
    for (const f of [
      { code: 'DEMO-PHC-1', name: 'DEMO Primary Health Centre 1', lga: 'Demo LGA A' },
      { code: 'DEMO-PHC-2', name: 'DEMO Primary Health Centre 2', lga: 'Demo LGA B' },
    ]) {
      await FacilityModel.updateOne({ organisationId: org._id, code: f.code }, { $setOnInsert: { ...f, organisationId: org._id, type: 'phc' } }, { upsert: true });
    }
    for (const c of [
      { name: 'DEMO Community 1', lga: 'Demo LGA A' },
      { name: 'DEMO Community 2', lga: 'Demo LGA B' },
    ]) {
      await CommunityModel.updateOne({ organisationId: org._id, lga: c.lga, name: c.name }, { $setOnInsert: { ...c, organisationId: org._id } }, { upsert: true });
    }
    console.log('Demo reference data ready: organisation DEMO, 2 facilities, 2 communities.');
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
