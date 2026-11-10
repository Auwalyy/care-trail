import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient', () => {
  it('sends the bearer token and builds query strings', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data: { ok: true }, meta: { requestId: 'r1' } }));
    const client = new ApiClient({
      baseUrl: 'http://api.test/api/v1/',
      getAccessToken: () => 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const data = await client.getData<{ ok: boolean }>('/patients', {
      query: { page: 2, q: 'amina', empty: '', skip: undefined },
    });
    expect(data).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/patients?page=2&q=amina');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('maps error envelopes to ApiError', async () => {
    const client = new ApiClient({
      baseUrl: 'http://api.test',
      fetchImpl: (async () =>
        jsonResponse(400, {
          error: { code: 'VALIDATION_ERROR', message: 'bad', details: [{ path: 'phone', message: 'x' }] },
          meta: { requestId: 'r2' },
        })) as unknown as typeof fetch,
    });
    const err = await client.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'r2' });
    expect((err as ApiError).fieldErrors).toHaveLength(1);
    expect((err as ApiError).isTransient).toBe(false);
  });

  it('reports network failures as transient', async () => {
    const client = new ApiClient({
      baseUrl: 'http://api.test',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    const err = (await client.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.isTransient).toBe(true);
  });

  it('refreshes once on 401 and retries', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls === 1
        ? jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' }, meta: { requestId: 'a' } })
        : jsonResponse(200, { data: 1, meta: { requestId: 'b' } });
    }) as unknown as typeof fetch;
    const onUnauthorized = vi.fn(async () => true);
    const client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl, onUnauthorized, getAccessToken: () => 't' });
    expect(await client.getData('/x')).toBe(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  it('does not loop when refresh fails', async () => {
    const fetchImpl = (async () =>
      jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'no' }, meta: { requestId: 'a' } })) as unknown as typeof fetch;
    const client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl, onUnauthorized: async () => false });
    const err = (await client.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(401);
  });
});
