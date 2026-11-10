import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase, pingDatabase } from '../src/database/connection.js';
import { silentLogger, testEnv } from './helpers.js';

describe('MongoDB connection (replica set)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await connectDatabase({ uri: replSet.getUri('caretrail-test'), logger: silentLogger, maxAttempts: 1 });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await replSet?.stop();
  });

  it('pings the database', async () => {
    const r = await pingDatabase();
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeTypeOf('number');
  });

  it('can run a multi-document transaction', async () => {
    const A = mongoose.model('TxA', new mongoose.Schema({ n: Number }));
    const B = mongoose.model('TxB', new mongoose.Schema({ n: Number }));
    await A.createCollection();
    await B.createCollection();

    await expect(
      mongoose.connection.transaction(async (session) => {
        await A.create([{ n: 1 }], { session });
        await B.create([{ n: 1 }], { session });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await A.countDocuments()).toBe(0);
    expect(await B.countDocuments()).toBe(0);

    await mongoose.connection.transaction(async (session) => {
      await A.create([{ n: 2 }], { session });
      await B.create([{ n: 2 }], { session });
    });
    expect(await A.countDocuments()).toBe(1);
    expect(await B.countDocuments()).toBe(1);
  });

  it('reports ready through the HTTP readiness probe', async () => {
    const app = createApp({ env: testEnv(), logger: silentLogger });
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.mongodb.status).toBe('up');
  });
});

describe('MongoDB connection (standalone)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  it('refuses to start without transaction support', async () => {
    await expect(
      connectDatabase({ uri: server.getUri('caretrail-test'), logger: silentLogger, maxAttempts: 1 }),
    ).rejects.toThrow(/replica set/);
    expect(mongoose.connection.readyState).toBe(0);
  });
});

describe('MongoDB connection (unreachable)', () => {
  it('retries and then fails', async () => {
    await expect(
      connectDatabase({
        uri: 'mongodb://127.0.0.1:1/caretrail-test?serverSelectionTimeoutMS=200',
        logger: silentLogger,
        maxAttempts: 2,
        initialDelayMs: 10,
      }),
    ).rejects.toThrow();
  }, 30_000);
});
