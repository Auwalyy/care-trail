'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import type { HealthStatus } from '@caretrail/shared-types';
import { errorMessage } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient } from '@/services/api';

function StatusDot({ up }: { up: boolean }) {
  return <span aria-hidden className={`inline-block size-2.5 rounded-full ${up ? 'bg-success-700' : 'bg-danger-700'}`} />;
}

/** Live readiness of the API and its dependencies (a 503 still carries the real status body). */
export function SystemStatus() {
  const { data, error, isPending, refetch, isFetching, dataUpdatedAt } = useQuery<HealthStatus>({
    queryKey: ['system', 'readiness'],
    queryFn: () => apiClient.readiness(),
    refetchInterval: 60_000,
    retry: false,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-5 text-brand-600" aria-hidden /> System status
        </CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Checking…' : 'Check again'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isPending && <p role="status" className="text-sm text-muted-foreground">Checking the CARETRAIL API…</p>}
        {error && <p role="alert" className="rounded-md bg-danger-50 p-3 text-sm text-danger-700">{errorMessage(error)}</p>}
        {data && (
          <dl className="grid gap-3 text-sm">
            <div className="flex items-center gap-2">
              <StatusDot up={data.status === 'ok'} />
              <dt className="text-muted-foreground">API</dt>
              <dd className="ms-auto font-medium">{data.status === 'ok' ? 'Ready' : 'Not ready'}</dd>
            </div>
            {Object.entries(data.checks ?? {}).map(([name, check]) => (
              <div key={name} className="flex items-center gap-2">
                <StatusDot up={check.status === 'up'} />
                <dt className="text-muted-foreground">{name === 'mongodb' ? 'Database' : name}</dt>
                <dd className="ms-auto font-medium">
                  {check.status === 'up' ? `Up${check.latencyMs !== undefined ? ` · ${check.latencyMs} ms` : ''}` : 'Down'}
                </dd>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Version {data.version} · checked {new Date(dataUpdatedAt).toLocaleTimeString()}
            </p>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
