import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './database/connection.js';
import { createLogger } from './utils/logger.js';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main() {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV === 'development' });

  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled promise rejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    process.exit(1);
  });

  await connectDatabase({ uri: env.MONGODB_URI, logger });

  let stopMissedCare: (() => void) | undefined;
  const app = createApp({
    env,
    logger,
    onMissedCare: (svc) => {
      if (env.MISSED_CARE_INTERVAL_MINUTES > 0) stopMissedCare = svc.start(env.MISSED_CARE_INTERVAL_MINUTES);
    },
  });
  const server: Server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'CARETRAIL API listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    stopMissedCare?.();
    const forceExit = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000);
    forceExit.unref();
    server.close(async () => {
      await disconnectDatabase().catch((err) => logger.error({ err }, 'Error closing MongoDB'));
      logger.info('Shutdown complete');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  // Logger may not exist yet (e.g. invalid env) — write a minimal message without secrets.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
