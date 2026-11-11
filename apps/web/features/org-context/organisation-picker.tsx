'use client';

import { Building2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrganisations } from '@/features/directory/use-directory';
import { useActiveOrganisation } from './active-organisation';

const ALL = '__all__';

/** Organisation switcher for platform administrators. Renders nothing for other roles. */
export function OrganisationPicker({ allowAll = false }: { allowAll?: boolean }) {
  const { isPlatform, organisationId, setOrganisationId } = useActiveOrganisation();
  const orgs = useOrganisations();
  if (!isPlatform) return null;

  return (
    <Select value={organisationId ?? (allowAll ? ALL : '')} onValueChange={(v) => setOrganisationId(v === ALL ? null : v)}>
      <SelectTrigger className="h-9 min-w-56" aria-label="Organisation">
        <Building2 className="size-4 text-muted-foreground" aria-hidden />
        <SelectValue placeholder="Choose an organisation" />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL}>All organisations</SelectItem>}
        {(orgs.data ?? []).map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
            {o.status === 'inactive' && ' (inactive)'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
