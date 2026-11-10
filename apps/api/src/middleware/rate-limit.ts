import { rateLimit, type Options } from 'express-rate-limit';
import type { ApiErrorBody } from '@caretrail/shared-types';

function limiter(options: Partial<Options>) {
  return rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, opts) => {
      const body: ApiErrorBody = {
        error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
        meta: { requestId: res.locals.requestId as string },
      };
      res.status(opts.statusCode).json(body);
    },
    ...options,
  });
}

/** General API limit per client IP. In-memory store; switch to Redis store when scaling out. */
export const apiRateLimit = () => limiter({ windowMs: 60_000, limit: 300 });

/** Stricter limit for credential endpoints (login, forgot/reset password). */
export const authRateLimit = () => limiter({ windowMs: 15 * 60_000, limit: 20 });
