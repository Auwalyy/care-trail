import { useQuery } from '@tanstack/react-query';
import { useCan } from '@/features/auth/session-store';
import { api } from '@/services/api';

/** Active CHWs of an organisation (for assignment pickers and filters). */
export function useActiveChws(organisationId: string | null | undefined) {
  const allowed = useCan('chw:read');
  return useQuery({
    queryKey: ['chws', 'active', organisationId ?? 'own'],
    enabled: allowed,
    staleTime: 60_000,
    queryFn: async () => (await api.chws.list({ pageSize: 100, status: 'active', ...(organisationId ? { organisationId } : {}) })).data,
  });
}
