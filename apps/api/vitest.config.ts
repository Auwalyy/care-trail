import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // In-memory MongoDB replica set download/start can be slow on first run.
    hookTimeout: 120_000,
    // Each test file starts its own in-memory MongoDB replica set; cap concurrency so slower
    // machines don't time out starting a dozen mongod processes at once.
    maxWorkers: 4,
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
  },
});
