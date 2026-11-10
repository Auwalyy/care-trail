import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@caretrail/shared-types';
import { AppError } from '../utils/app-error.js';
import type { Logger } from '../utils/logger.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

function isMongoDuplicateKey(err: unknown): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/** Converts known error types into AppErrors. Unknown errors become INTERNAL_ERROR. */
export function normaliseError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(
      'VALIDATION_ERROR',
      'Request validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return new AppError(
      'VALIDATION_ERROR',
      'Request validation failed',
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  }
  if (err instanceof mongoose.Error.CastError) {
    return new AppError('VALIDATION_ERROR', `Invalid value for ${err.path}`);
  }
  if (isMongoDuplicateKey(err)) {
    // Only field names are returned — never the conflicting values (may be PII).
    return new AppError('CONFLICT', 'A record with the same unique value already exists', {
      fields: Object.keys(err.keyPattern ?? {}),
    });
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.parse.failed') return new AppError('VALIDATION_ERROR', 'Malformed JSON body');
  if (e?.type === 'entity.too.large') return new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large');
  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred');
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const appError = normaliseError(err);
    const requestId = (res.locals.requestId as string | undefined) ?? 'unknown';

    if (appError.status >= 500) {
      logger.error(
        { err, requestId, method: req.method, path: req.path },
        'Unhandled error while processing request',
      );
    } else {
      logger.debug({ requestId, code: appError.code, path: req.path }, appError.message);
    }

    if (res.headersSent) return;
    const body: ApiErrorBody = {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details !== undefined ? { details: appError.details } : {}),
      },
      meta: { requestId },
    };
    res.status(appError.status).json(body);
  };
}
