import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Permission } from '@caretrail/shared-types';
import { useCan } from '@/features/auth/session-store';
import { api } from '@/services/api';

const LIST_ALL = { pageSize: 200 } as const;

function useNameMap<T extends { id: string; name: string }>(items: T[] | undefined) {
  return useMemo(() => new Map((items ?? []).map((i) => [i.id, i.name])), [items]);
}

function useGuardedQuery<T>(key: string, permission: Permission, fn: () => Promise<{ data: T[] }>) {
  const allowed = useCan(permission);
  return useQuery({ queryKey: ['directory', key], queryFn: async () => (await fn()).data, enabled: allowed, staleTime: 5 * 60_000 });
}

/** All organisations/facilities/communities visible to the user (for pickers and name lookups). */
export function useOrganisations() {
  const q = useGuardedQuery('organisations', 'organisation:read', () => api.organisations.list(LIST_ALL));
  return { ...q, names: useNameMap(q.data) };
}

export function useFacilities() {
  const q = useGuardedQuery('facilities', 'facility:read', () => api.facilities.list(LIST_ALL));
  return { ...q, names: useNameMap(q.data) };
}

export function useCommunities() {
  const q = useGuardedQuery('communities', 'community:read', () => api.communities.list(LIST_ALL));
  return { ...q, names: useNameMap(q.data) };
}

/** Call after any reference-data change so pickers and name lookups refresh. */
export function useInvalidateDirectory() {
  const qc = useQueryClient();
  return (resource: string) =>
    Promise.all([qc.invalidateQueries({ queryKey: ['directory'] }), qc.invalidateQueries({ queryKey: [resource] }), qc.invalidateQueries({ queryKey: ['overview'] })]);
}
