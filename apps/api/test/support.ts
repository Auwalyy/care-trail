import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import type { Role } from '@caretrail/shared-types';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';
import type { PasswordLinkMessage, PasswordLinkNotifier } from '../src/modules/auth/password-link-notifier.js';
import { PasswordHasher } from '../src/modules/auth/password-hasher.js';
import { CommunityModel } from '../src/modules/communities/community.model.js';
import { FacilityModel } from '../src/modules/facilities/facility.model.js';
import { OrganisationModel } from '../src/modules/organisations/organisation.model.js';
import { UserModel, type UserDoc } from '../src/modules/users/user.model.js';
import { silentLogger, testEnv } from './helpers.js';

export const PASSWORD = 'correct-horse-battery';

/** Starts an in-memory replica set for the current test file and wipes data between tests. */
export function useTestDatabase() {
  let replSet: MongoMemoryReplSet;
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await connectDatabase({ uri: replSet.getUri('caretrail-test'), logger: silentLogger, maxAttempts: 1 });
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  });
  afterEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await disconnectDatabase();
    await replSet?.stop();
  });
}

export class TestClock {
  private offsetMs = 0;
  now = () => new Date(Date.now() + this.offsetMs);
  advance(ms: number) {
    this.offsetMs += ms;
  }
}

export class CapturingNotifier implements PasswordLinkNotifier {
  sent: PasswordLinkMessage[] = [];
  async send(message: PasswordLinkMessage) {
    this.sent.push(message);
    return { delivered: true };
  }
}

export function buildTestApp() {
  const clock = new TestClock();
  const notifier = new CapturingNotifier();
  const app = createApp({ env: testEnv(), logger: silentLogger, now: clock.now, passwordLinkNotifier: notifier });
  return { app, clock, notifier };
}

const hasher = new PasswordHasher();
let hashCache: string | null = null;

export async function createOrganisation(code: string) {
  return OrganisationModel.create({ name: `Org ${code}`, code, state: 'Kano' });
}
export async function createFacility(organisationId: Types.ObjectId, code: string) {
  return FacilityModel.create({ organisationId, name: `PHC ${code}`, code, lga: 'Dala' });
}
export async function createCommunity(organisationId: Types.ObjectId, name: string) {
  return CommunityModel.create({ organisationId, name, lga: 'Dala' });
}

export async function createUser(
  role: Role,
  overrides: Partial<UserDoc> = {},
  password: string | null = PASSWORD,
): Promise<UserDoc> {
  hashCache ??= await hasher.hash(PASSWORD);
  const passwordHash = password === null ? undefined : password === PASSWORD ? hashCache : await hasher.hash(password);
  const doc = await UserModel.create({
    email: `${role}.${Math.random().toString(36).slice(2, 10)}@example.org`,
    fullName: `Test ${role}`,
    role,
    status: password === null ? 'pending_activation' : 'active',
    ...(passwordHash ? { passwordHash } : {}),
    ...overrides,
  });
  return doc.toObject();
}

export async function login(
  app: Parameters<typeof request>[0],
  email: string,
  password = PASSWORD,
  client: 'web' | 'mobile' = 'mobile',
) {
  return request(app).post('/api/v1/auth/login').send({ email, password, client });
}

/** Logs in as a mobile client and returns the bearer header value plus refresh token. */
export async function signIn(app: Parameters<typeof request>[0], user: UserDoc) {
  const res = await login(app, user.email);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    bearer: `Bearer ${res.body.data.accessToken as string}`,
    refreshToken: res.body.data.refreshToken as string,
  };
}

export function tokenFromLink(url: string): string {
  return new URL(url).searchParams.get('token')!;
}
