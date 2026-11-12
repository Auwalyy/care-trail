import type { ApiClient } from '@caretrail/api-client';
import type { ApiSuccess, SyncPullResponse, SyncPushRequest, SyncPushResponse } from '@caretrail/shared-types';
import type { Transport } from './types.js';

/** Transport over the CARETRAIL REST API (token refresh is handled by the ApiClient). */
export class HttpTransport implements Transport {
  constructor(private readonly client: ApiClient) {}

  async push(req: SyncPushRequest): Promise<SyncPushResponse> {
    return (await this.client.post<ApiSuccess<SyncPushResponse>>('/sync/push', req, { timeoutMs: 60_000 })).data;
  }

  async pull(since: string | null): Promise<SyncPullResponse> {
    return (await this.client.get<ApiSuccess<SyncPullResponse>>('/sync/pull', { query: since ? { since } : {}, timeoutMs: 60_000 })).data;
  }
}
