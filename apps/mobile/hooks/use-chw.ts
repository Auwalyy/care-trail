import { useSession } from '@/store/session';

/** The signed-in CHW as referenced on locally created records. */
export function useChw() {
  const user = useSession((s) => s.user);
  return { id: user?.id ?? '', name: user?.fullName ?? '', organisationId: user?.organisationId ?? '', communityIds: user?.communityIds ?? [] };
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const plusDaysIso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
