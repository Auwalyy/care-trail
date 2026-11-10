import type { ApiErrorBody, ErrorCode } from '@caretrail/shared-types';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  POSSIBLE_DUPLICATE: 409,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_TRANSITION: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/** An expected, client-safe error. Anything that is not an AppError is reported as a 500. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ApiErrorBody['error']['details'];

  constructor(code: ErrorCode, message: string, details?: ApiErrorBody['error']['details']) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  static notFound(resource = 'Resource') {
    return new AppError('NOT_FOUND', `${resource} not found`);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError('FORBIDDEN', message);
  }
  static unauthenticated(message = 'Authentication required') {
    return new AppError('UNAUTHENTICATED', message);
  }
  static conflict(message: string, details?: ApiErrorBody['error']['details']) {
    return new AppError('CONFLICT', message, details);
  }
}
