'use client';

import { useQuery } from '@tanstack/react-query';
import type { HealthStatus } from '@caretrail/shared-types';
import { api } from '@/services/api';
import { ApiError } from '@caretrail/api-client';

function StatusDot({ up }: { up: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2.5 rounded-full ${up ? 'bg-success-700' : 'bg-danger-700'}`}
    />
  );
}

/** Live readiness of the API and its dependencies (a 503 still carries the real status body). */
export function SystemStatus() {
  const { data, error, isPending, refetch, isFetching, dataUpdatedAt } = useQuery<HealthStatus>({
    queryKey: ['system', 'readiness'],
    queryFn: () => api.readiness(),
    refetchInterval: 30_000,
    retry: false,
  });

  return (
    <section
      aria-labelledby="system-status-heading"
      className="rounded-(--radius-card) border border-border bg-surface p-6 shadow-(--shadow-card)"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="system-status-heading" className="text-base font-semibold">
          System status
        </h2>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-canvas disabled:opacity-50"
        >
          {isFetching ? 'Checking…' : 'Check again'}
        </button>
      </div>

      {isPending && (
        <p role="status" className="mt-4 text-sm text-ink-muted">
          Checking the CARETRAIL API…
        </p>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-md bg-danger-50 p-4 text-sm text-danger-700">
          <p className="font-medium">The API could not be reached.</p>
          <p className="mt-1">
            {error instanceof ApiError ? error.message : 'Unknown error'} — check that the API is running
            and that <code>NEXT_PUBLIC_API_URL</code> points to it.
          </p>
        </div>
      )}

      {data && (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <StatusDot up={data.status === 'ok'} />
            <dt className="text-ink-muted">API</dt>
            <dd className="font-medium">{data.status === 'ok' ? 'Ready' : 'Not ready'}</dd>
          </div>
          {Object.entries(data.checks ?? {}).map(([name, check]) => (
            <div key={name} className="flex items-center gap-2">
              <StatusDot up={check.status === 'up'} />
              <dt className="text-ink-muted">{name === 'mongodb' ? 'Database' : name}</dt>
              <dd className="font-medium">
                {check.status === 'up' ? `Up${check.latencyMs !== undefined ? ` · ${check.latencyMs} ms` : ''}` : 'Down'}
              </dd>
            </div>
          ))}
          <div className="text-ink-subtle sm:col-span-2">
            API version {data.version} · checked {new Date(dataUpdatedAt).toLocaleTimeString()}
          </div>
        </dl>
      )}
    </section>
  );
}
