'use client';

import type { CommunityDto, FacilityDto } from '@caretrail/shared-types';
import { FormField } from '@/components/form/form-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function FacilitySelect({
  facilities,
  value,
  onChange,
  error,
  disabled,
}: {
  facilities: FacilityDto[];
  value: string | null | undefined;
  onChange: (id: string) => void;
  error?: string | undefined;
  disabled?: boolean;
}) {
  return (
    <FormField id="facilityId" label="Facility" error={error ?? (facilities.length === 0 ? 'No facilities are registered for this organisation yet.' : undefined)}>
      <Select value={value ?? ''} onValueChange={onChange} disabled={disabled || facilities.length === 0}>
        <SelectTrigger id="facilityId" className="w-full" aria-invalid={error ? true : undefined}>
          <SelectValue placeholder="Select a facility" />
        </SelectTrigger>
        <SelectContent>
          {facilities.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name} <span className="text-muted-foreground">· {f.lga}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

export function CommunityPicker({
  communities,
  value,
  onChange,
  error,
}: {
  communities: CommunityDto[];
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string | undefined;
}) {
  const toggle = (id: string, checked: boolean) => onChange(checked ? [...value, id] : value.filter((v) => v !== id));
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Communities</legend>
      {communities.length === 0 ? (
        <p className="text-sm text-danger-700">No communities are registered for this organisation yet.</p>
      ) : (
        <div className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border p-2" aria-invalid={error ? true : undefined}>
          {communities.map((c) => (
            <Label key={c.id} className="flex h-9 cursor-pointer items-center gap-3 rounded-md px-2 font-normal hover:bg-muted">
              <Checkbox checked={value.includes(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} />
              <span>{c.name}</span>
              <span className="ms-auto text-xs text-muted-foreground">{c.lga}</span>
            </Label>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
    </fieldset>
  );
}
