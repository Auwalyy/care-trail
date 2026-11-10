import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Paths that must never reach log output. Patient data is additionally protected by never logging
 * request/response bodies (see request logging middleware).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.phone',
  '*.fullName',
  '*.dateOfBirth',
  'password',
  'token',
  'refreshToken',
  'accessToken',
];

export function createLogger(options: { level: string; pretty?: boolean; name?: string }): Logger {
  const config: LoggerOptions = {
    name: options.name ?? 'caretrail-api',
    level: options.level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: options.name ?? 'caretrail-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
  if (options.pretty) {
    config.transport = { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } };
  }
  return pino(config);
}

export type { Logger };
