import type {
  ApiErrorBody,
  ApiErrorDetail,
  ApiList,
  ApiSuccess,
  ErrorCode,
  HealthStatus,
} from '@caretrail/shared-types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE';
  readonly details: ApiErrorBody['error']['details'];
  readonly requestId: string | undefined;

  constructor(init: {
    status: number;
    code: ApiError['code'];
    message: string;
    details?: ApiErrorBody['error']['details'];
    requestId?: string;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
  }

  /** True for failures worth retrying later (offline, timeout, 5xx, 429). */
  get isTransient(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT' ||
      this.status === 429 ||
      this.status >= 500
    );
  }

  get fieldErrors(): ApiErrorDetail[] {
    return Array.isArray(this.details) ? this.details : [];
  }
}

export type QueryValue = string | number | boolean | Date | undefined | null;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the auth header (login, refresh, public endpoints). */
  anonymous?: boolean;
  timeoutMs?: number;
  /** Non-2xx statuses whose body should be returned instead of thrown (e.g. 503 from readiness). */
  acceptStatuses?: number[];
}

export interface ApiClientConfig {
  /** e.g. https://api.caretrail.example/api/v1 */
  baseUrl: string;
  /** Returns the current access token, if any. */
  getAccessToken?: () => string | null | Promise<string | null>;
  /**
   * Called once when a request fails with 401. Should refresh the session and resolve true if
   * the request can be retried, false otherwise (caller then logs the user out).
   */
  onUnauthorized?: () => Promise<boolean>;
  /** Send cookies (web refresh-token cookie). */
  credentials?: 'include' | 'same-origin' | 'omit';
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, value instanceof Date ? value.toISOString() : String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export class ApiClient {
  private readonly config: Required<Pick<ApiClientConfig, 'baseUrl' | 'defaultTimeoutMs'>> &
    ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = { defaultTimeoutMs: 20_000, ...config, baseUrl: config.baseUrl.replace(/\/$/, '') };
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}, retried = false): Promise<T> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (!options.anonymous && this.config.getAccessToken) {
      const token = await this.config.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.config.defaultTimeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    let response: Response;
    try {
      const init: RequestInit = { method, headers, signal: controller.signal };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);
      if (this.config.credentials) init.credentials = this.config.credentials;
      response = await fetchImpl(`${this.config.baseUrl}${path}${buildQuery(options.query)}`, init);
    } catch (err) {
      const timedOut = controller.signal.aborted && !options.signal?.aborted;
      throw new ApiError({
        status: 0,
        code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: timedOut ? 'The request timed out' : 'Network unavailable',
        details: { cause: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }

    if (response.status === 401 && !options.anonymous && !retried && this.config.onUnauthorized) {
      if (await this.config.onUnauthorized()) return this.request<T>(method, path, options, true);
    }

    if (response.status === 204) return undefined as T;

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError({
        status: response.status,
        code: response.ok ? 'INVALID_RESPONSE' : response.status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_RESPONSE',
        message: `Unexpected response from server (${response.status})`,
      });
    }

    if (!response.ok && !options.acceptStatuses?.includes(response.status)) {
      const body = payload as Partial<ApiErrorBody>;
      throw new ApiError({
        status: response.status,
        code: body.error?.code ?? 'INTERNAL_ERROR',
        message: body.error?.message ?? `Request failed (${response.status})`,
        details: body.error?.details,
        ...(body.meta?.requestId ? { requestId: body.meta.requestId } : {}),
      });
    }
    return payload as T;
  }

  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, options);
  }
  post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('POST', path, { ...options, body });
  }
  patch<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PATCH', path, { ...options, body });
  }
  delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>('DELETE', path, options);
  }

  /** Unwraps the `{ data }` envelope. */
  async getData<T>(path: string, options?: RequestOptions): Promise<T> {
    return (await this.get<ApiSuccess<T>>(path, options)).data;
  }

  getList<T>(path: string, options?: RequestOptions): Promise<ApiList<T>> {
    return this.get<ApiList<T>>(path, options);
  }

  // ── Endpoints ────────────────────────────────────────────────────────────────
  health(): Promise<HealthStatus> {
    return this.get<HealthStatus>('/health', { anonymous: true });
  }

  /** Resolves with the HealthStatus body for both 200 (ready) and 503 (dependency down). */
  readiness(): Promise<HealthStatus> {
    return this.get<HealthStatus>('/health/ready', { anonymous: true, acceptStatuses: [503] });
  }
}
