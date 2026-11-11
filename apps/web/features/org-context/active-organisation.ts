import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useSession } from '@/features/auth/session-store';

/**
 * The organisation a platform administrator is currently working in. Only an id is stored (not
 * sensitive). Everyone else is pinned to their own organisation, and the API enforces that anyway.
 */
const usePlatformOrg = create<{ organisationId: string | null; set: (id: string | null) => void }>()(
  persist((set) => ({ organisationId: null, set: (organisationId) => set({ organisationId }) }), {
    name: 'caretrail.platform.organisation',
    storage: createJSONStorage(() => localStorage),
  }),
);

export function useActiveOrganisation() {
  const user = useSession((s) => s.user);
  const platformOrg = usePlatformOrg();
  const isPlatform = user?.role === 'platform_admin';
  return {
    isPlatform,
    /** null = platform admin viewing all organisations (only where a page allows it). */
    organisationId: isPlatform ? platformOrg.organisationId : (user?.organisationId ?? null),
    setOrganisationId: platformOrg.set,
  };
}
