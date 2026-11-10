import type { HealthCheckResult, HealthStatus } from '@caretrail/shared-types';

export type HealthCheck = () => Promise<{ ok: boolean; latencyMs?: number; error?: string }>;

export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly version: string,
    private readonly checks: Record<string, HealthCheck>,
  ) {}

  liveness(): HealthStatus {
    return this.base('ok');
  }

  async readiness(): Promise<HealthStatus> {
    const entries = await Promise.all(
      Object.entries(this.checks).map(async ([name, check]): Promise<[string, HealthCheckResult]> => {
        try {
          const r = await check();
          const result: HealthCheckResult = { status: r.ok ? 'up' : 'down' };
          if (r.latencyMs !== undefined) result.latencyMs = r.latencyMs;
          if (r.error) result.error = r.error;
          return [name, result];
        } catch (err) {
          return [name, { status: 'down', error: err instanceof Error ? err.message : 'check failed' }];
        }
      }),
    );
    const checks = Object.fromEntries(entries);
    const allUp = entries.every(([, r]) => r.status === 'up');
    return { ...this.base(allUp ? 'ok' : 'down'), checks };
  }

  private base(status: HealthStatus['status']): HealthStatus {
    return {
      status,
      service: 'caretrail-api',
      version: this.version,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
