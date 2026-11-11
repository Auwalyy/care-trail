import mongoose from 'mongoose';
import type { Logger } from '../utils/logger.js';

export interface ConnectOptions {
  uri: string;
  logger: Logger;
  maxAttempts?: number;
  initialDelayMs?: number;
  /** Fail fast if the deployment cannot run multi-document transactions. Default true. */
  requireTransactions?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Host part only, so credentials in the URI are never logged. */
export function describeMongoUri(uri: string): string {
  try {
    const u = new URL(uri);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[unparseable uri]';
  }
}

/**
 * Transactions (used for referral transitions, sync ops, audit) need a replica set or sharded
 * cluster. A standalone mongod accepts writes but rejects transactions at runtime — detect early.
 */
export async function supportsTransactions(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;
  const hello = await db.admin().command({ hello: 1 });
  return Boolean(hello.setName) || hello.msg === 'isdbgrid';
}

export async function connectDatabase(options: ConnectOptions): Promise<typeof mongoose> {
  const { uri, logger, maxAttempts = 10, initialDelayMs = 500, requireTransactions = true } = options;
  mongoose.set('strictQuery', true);
  // Never let Mongoose buffer commands for minutes when the DB is down — fail the request instead.
  mongoose.set('bufferCommands', false);

  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000, autoIndex: true });
      break;
    } catch (err) {
      if (attempt >= maxAttempts) {
        logger.fatal({ err, target: describeMongoUri(uri), attempt }, 'Could not connect to MongoDB');
        throw err;
      }
      const delay = Math.min(initialDelayMs * 2 ** (attempt - 1), 15_000);
      logger.warn({ target: describeMongoUri(uri), attempt, retryInMs: delay }, 'MongoDB connection failed, retrying');
      await sleep(delay);
    }
  }

  if (requireTransactions && !(await supportsTransactions())) {
    await mongoose.disconnect();
    throw new Error(
      'MongoDB deployment does not support transactions. Run MongoDB as a replica set (see docker-compose.yml).',
    );
  }

  logger.info({ target: describeMongoUri(uri) }, 'Connected to MongoDB');
  closing = false;
  mongoose.connection.on('disconnected', () => {
    if (!closing) logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
  return mongoose;
}

/** True while we are deliberately closing, so the disconnect is not reported as a fault. */
let closing = false;

export async function disconnectDatabase(): Promise<void> {
  closing = true;
  await mongoose.disconnect();
}

export async function pingDatabase(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== 1 || !db) return { ok: false, error: 'not connected' };
  const started = performance.now();
  try {
    await db.admin().command({ ping: 1 });
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'ping failed' };
  }
}
