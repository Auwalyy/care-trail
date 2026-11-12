import { useEffect, useState } from 'react';
import { create } from 'zustand';

/** Bumped whenever local data changes (writes, sync results, pulls) so screens re-read SQLite. */
export const useDataVersion = create<{ version: number }>(() => ({ version: 0 }));

export function notifyDataChanged() {
  useDataVersion.setState((s) => ({ version: s.version + 1 }));
}

/** Runs an async local query and re-runs it whenever local data changes. */
export function useLocalQuery<T>(query: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; error: unknown; loading: boolean } {
  const version = useDataVersion((s) => s.version);
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    query()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error: unknown) => alive && setState((s) => ({ ...s, error, loading: false })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return state;
}
