import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

/** Active programme/facility staff of an organisation — candidates to supervise CHWs. */
export function useSupervisorCandidates(organisationId: string | null | undefined) {
  return useQuery({
    queryKey: ['users', 'supervisors', organisationId],
    enabled: Boolean(organisationId),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await api.users.list({ pageSize: 100, status: 'active', ...(organisationId ? { organisationId } : {}) });
      return res.data.filter((u) => u.role === 'programme_admin' || u.role === 'facility_admin' || u.role === 'facility_worker');
    },
  });
}

/** "Antenatal follow-up, Immunisation" ⇄ ['Antenatal follow-up', 'Immunisation'] */
export const parseAreas = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
