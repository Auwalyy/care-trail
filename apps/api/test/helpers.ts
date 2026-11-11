import { loadEnv, type Env } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/caretrail-test',
    CORS_ORIGINS: 'http://localhost:3000',
    JWT_ACCESS_SECRET: 'test-secret-that-is-long-enough-for-hs256-0123456789',
    WEB_APP_URL: 'http://localhost:3000',
    ...overrides,
  });
}

export const silentLogger = createLogger({ level: 'silent' });
