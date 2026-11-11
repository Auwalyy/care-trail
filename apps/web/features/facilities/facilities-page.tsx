'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Hospital, Loader2, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FACILITY_TYPES, FACILITY_TYPE_LABELS, type FacilityDto } from '@caretrail/shared-types';
import { createFacilitySchema } from '@caretrail/validation';
import type { Column } from '@/components/data/data-table';
import { RecordStatusBadge } from '@/components/data/record-status-badge';
import { applyApiErrors } from '@/components/form/apply-api-errors';
import { FormField, fieldAria } from '@/components/form/form-field';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RequirePermission } from '@/features/auth/require-session';
import { useCan } from '@/features/auth/session-store';
import { ReferenceList } from '@/features/directory/reference-list';
import { StatusMenuItem } from '@/features/directory/status-action';
import { useInvalidateDirectory } from '@/features/directory/use-directory';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { api } from '@/services/api';

const schema = createFacilitySchema.omit({ organisationId: true });
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;
const FIELDS = ['name', 'code', 'type', 'lga', 'ward', 'address', 'phone'] as const;

function FacilityDialog({ editing, open, organisationId, onClose }: { editing: FacilityDto | null; open: boolean; organisationId: string | null; onClose: () => void }) {
  const invalidate = useInvalidateDirectory();
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema) });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) return;
    form.reset(
      editing
        ? { name: editing.name, code: editing.code, type: editing.type, lga: editing.lga, ward: editing.ward ?? '', address: editing.address ?? '', phone: editing.phone ?? '' }
        : { name: '', code: '', type: 'phc', lga: '', ward: '', address: '', phone: '' },
    );
  }, [open, editing, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      if (editing) {
        // The code is immutable, so it is not sent on update.
        await api.facilities.update(editing.id, {
          name: v.name,
          type: v.type,
          lga: v.lga,
          ward: v.ward ?? null,
          address: v.address ?? null,
          phone: v.phone ?? null,
          version: editing.version,
        });
      } else {
        await api.facilities.create({ ...v, organisationId });
      }
      toast.success(editing ? 'Facility updated' : 'Facility registered');
      await invalidate('facilities');
      onClose();
    } catch (err) {
      applyApiErrors(err, form.setError, FIELDS);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit facility' : 'Register facility'}</DialogTitle>
          <DialogDescription>Facilities receive referrals and host appointments.</DialogDescription>
        </DialogHeader>
        <form id="facility-form" onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormField id="fac-name" label="Name" error={errors.name?.message}>
            <Input {...fieldAria('fac-name', errors.name?.message)} {...form.register('name')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="fac-code" label="Code" error={errors.code?.message} hint={editing ? 'Codes cannot be changed' : 'Unique in your organisation'}>
              <Input disabled={Boolean(editing)} className="uppercase" {...fieldAria('fac-code', errors.code?.message, true)} {...form.register('code')} />
            </FormField>
            <FormField id="fac-type" label="Type">
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value ?? 'phc'} onValueChange={field.onChange}>
                    <SelectTrigger id="fac-type" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{FACILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{FACILITY_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField id="fac-lga" label="LGA" error={errors.lga?.message}>
              <Input {...fieldAria('fac-lga', errors.lga?.message)} {...form.register('lga')} />
            </FormField>
            <FormField id="fac-ward" label="Ward (optional)" error={errors.ward?.message}>
              <Input {...fieldAria('fac-ward', errors.ward?.message)} {...form.register('ward')} />
            </FormField>
          </div>
          <FormField id="fac-address" label="Address or landmark (optional)" error={errors.address?.message}>
            <Input {...fieldAria('fac-address', errors.address?.message)} {...form.register('address')} />
          </FormField>
          <FormField id="fac-phone" label="Facility phone (optional)" error={errors.phone?.message}>
            <Input type="tel" inputMode="tel" {...fieldAria('fac-phone', errors.phone?.message)} {...form.register('phone')} />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="facility-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            {editing ? 'Save changes' : 'Register facility'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FacilitiesContent() {
  const canManage = useCan('facility:manage');
  const { isPlatform, organisationId } = useActiveOrganisation();
  const [dialog, setDialog] = useState<{ open: boolean; editing: FacilityDto | null }>({ open: false, editing: null });
  const invalidate = useInvalidateDirectory();
  const needsOrg = isPlatform && !organisationId;

  const columns: Column<FacilityDto>[] = [
    { key: 'name', header: 'Facility', cell: (f) => <><div className="font-medium">{f.name}</div><div className="text-xs text-muted-foreground">{f.code}</div></> },
    { key: 'type', header: 'Type', className: 'hidden md:table-cell', cell: (f) => FACILITY_TYPE_LABELS[f.type] },
    { key: 'lga', header: 'LGA / ward', cell: (f) => <>{f.lga}{f.ward && <span className="text-muted-foreground"> · {f.ward}</span>}</> },
    { key: 'phone', header: 'Phone', className: 'hidden lg:table-cell', cell: (f) => f.phone ?? '—' },
    { key: 'status', header: 'Status', cell: (f) => <RecordStatusBadge status={f.status} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-12',
      cell: (f) =>
        canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${f.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog({ open: true, editing: f })}><Pencil aria-hidden /> Edit</DropdownMenuItem>
              <DropdownMenuSeparator />
              <StatusMenuItem name={f.name} kind="facility" status={f.status} onChange={async (status) => { await api.facilities.update(f.id, { status, version: f.version }); await invalidate('facilities'); }} />
            </DropdownMenuContent>
          </DropdownMenu>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Facilities"
        description="Primary healthcare facilities that receive referrals."
        actions={
          <>
            <OrganisationPicker />
            {canManage && !needsOrg && <Button className="h-9" onClick={() => setDialog({ open: true, editing: null })}><Plus aria-hidden /> Register facility</Button>}
          </>
        }
      />
      {needsOrg ? (
        <EmptyState icon={Hospital} title="Choose an organisation" description="Select an organisation above to see and manage its facilities." />
      ) : (
        <ReferenceList
          key={organisationId ?? 'own'}
          resource="facilities"
          fetcher={api.facilities.list}
          organisationId={isPlatform ? organisationId : undefined}
          columns={columns}
          searchLabel="Search by name, code or LGA"
          empty={{ icon: Hospital, title: 'No facilities registered yet', ...(canManage ? { description: 'Register the facilities that take part in the programme.' } : {}) }}
        />
      )}
      <FacilityDialog open={dialog.open} editing={dialog.editing} organisationId={isPlatform ? organisationId : null} onClose={() => setDialog({ open: false, editing: null })} />
    </>
  );
}

export function FacilitiesPage() {
  return (
    <RequirePermission permission="facility:read">
      <FacilitiesContent />
    </RequirePermission>
  );
}
