export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'POSSIBLE_DUPLICATE',
  'INVALID_TRANSITION',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ResponseMeta {
  requestId: string;
}

export interface PaginationMeta extends ResponseMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ResponseMeta;
}

export interface ApiList<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ApiErrorDetail {
  path?: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ApiErrorDetail[] | Record<string, unknown>;
  };
  meta: ResponseMeta;
}

export interface HealthCheckResult {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  checks?: Record<string, HealthCheckResult>;
}
