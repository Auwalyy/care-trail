import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { silentLogger, testEnv } from './helpers.js';

const upApp = () =>
  createApp({
    env: testEnv(),
    logger: silentLogger,
    healthChecks: { mongodb: async () => ({ ok: true, latencyMs: 1 }) },
  });

describe('HTTP foundation', () => {
  it('serves liveness without touching dependencies', async () => {
    const res = await request(upApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'caretrail-api' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reports readiness 503 when a dependency is down', async () => {
    const app = createApp({
      env: testEnv(),
      logger: silentLogger,
      healthChecks: { mongodb: async () => ({ ok: false, error: 'not connected' }) },
    });
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.mongodb).toEqual({ status: 'down', error: 'not connected' });
  });

  it('attaches and echoes request ids', async () => {
    const res = await request(upApp()).get('/api/v1/health').set('X-Request-Id', 'abc12345-trace');
    expect(res.headers['x-request-id']).toBe('abc12345-trace');
    const generated = await request(upApp()).get('/api/v1/health').set('X-Request-Id', 'bad id!');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const res = await request(upApp()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.meta.requestId).toBe(res.headers['x-request-id']);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(upApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await request(upApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ x: 'a'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(upApp()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('enforces the CORS allowlist', async () => {
    const ok = await request(upApp()).get('/api/v1/health').set('Origin', 'http://localhost:3000');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const blocked = await request(upApp()).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(blocked.status).toBe(403);
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('publishes the OpenAPI document', async () => {
    const res = await request(upApp()).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/health']).toBeDefined();
    expect(res.body.paths['/auth/login'].post.requestBody.content['application/json'].schema.properties.email).toBeDefined();
    expect(res.body.paths['/users/{id}/status']).toBeDefined();
  });

  it('can disable API docs', async () => {
    const app = createApp({ env: testEnv({ API_DOCS_ENABLED: 'false' }), logger: silentLogger });
    expect((await request(app).get('/api/openapi.json')).status).toBe(404);
  });
});
