'use client';

import { ROLE_LABELS, type UserDto } from '@caretrail/shared-types';
import { FormField } from '@/components/form/form-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = '__none__';

export function ProgrammeAreasField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | undefined }) {
  return (
    <FormField id="programmeAreas" label="Programme areas (optional)" error={error} hint="Separate with commas, e.g. Antenatal follow-up, Immunisation">
      <Input id="programmeAreas" value={value} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  );
}

export function ReferralAuthorisationField({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span>
        <span className="block font-medium">Authorised to issue referrals</span>
        <span className="block text-sm text-muted-foreground">Grant only in line with your programme&apos;s referral protocol.</span>
      </span>
    </Label>
  );
}

export function SupervisorField({
  candidates,
  value,
  onChange,
  error,
}: {
  candidates: UserDto[];
  value: string | null;
  onChange: (id: string | null) => void;
  error?: string | undefined;
}) {
  return (
    <FormField id="supervisorUserId" label="Supervisor (optional)" error={error}>
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger id="supervisorUserId" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No supervisor</SelectItem>
          {candidates.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.fullName} <span className="text-muted-foreground">· {ROLE_LABELS[u.role]}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}
