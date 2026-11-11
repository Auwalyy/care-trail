'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Loader2, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import type { OrganisationDto } from '@caretrail/shared-types';
import { createOrganisationSchema } from '@caretrail/validation';
import type { Column } from '@/components/data/data-table';
import { RecordStatusBadge } from '@/components/data/record-status-badge';
import { applyApiErrors } from '@/components/form/apply-api-errors';
import { FormField, fieldAria } from '@/components/form/form-field';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { RequirePermission } from '@/features/auth/require-session';
import { ReferenceList } from '@/features/directory/reference-list';
import { StatusMenuItem } from '@/features/directory/status-action';
import { useInvalidateDirectory } from '@/features/directory/use-directory';
import { formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';

type FormInput = z.input<typeof createOrganisationSchema>;
type FormOutput = z.output<typeof createOrganisationSchema>;

function OrganisationDialog({ editing, open, onClose }: { editing: OrganisationDto | null; open: boolean; onClose: () => void }) {
  const invalidate = useInvalidateDirectory();
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(createOrganisationSchema) });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (open) form.reset(editing ? { name: editing.name, code: editing.code, state: editing.state, contactEmail: editing.contactEmail ?? '' } : { name: '', code: '', state: 'Kano', contactEmail: '' });
  }, [open, editing, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      if (editing) await api.organisations.update(editing.id, { name: v.name, state: v.state, contactEmail: v.contactEmail ?? null, version: editing.version });
      else await api.organisations.create(v);
      toast.success(editing ? 'Organisation updated' : 'Organisation created');
      await invalidate('organisations');
      onClose();
    } catch (err) {
      applyApiErrors(err, form.setError, ['name', 'code', 'state', 'contactEmail']);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit organisation' : 'New organisation'}</DialogTitle>
          <DialogDescription>An organisation runs a programme and owns its facilities, communities and staff.</DialogDescription>
        </DialogHeader>
        <form id="org-form" onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormField id="org-name" label="Name" error={errors.name?.message}>
            <Input {...fieldAria('org-name', errors.name?.message)} {...form.register('name')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="org-code" label="Code" error={errors.code?.message} hint={editing ? 'Codes cannot be changed' : 'e.g. KANO-MNH'}>
              <Input disabled={Boolean(editing)} className="uppercase" {...fieldAria('org-code', errors.code?.message, true)} {...form.register('code')} />
            </FormField>
            <FormField id="org-state" label="State" error={errors.state?.message}>
              <Input {...fieldAria('org-state', errors.state?.message)} {...form.register('state')} />
            </FormField>
          </div>
          <FormField id="org-email" label="Contact email (optional)" error={errors.contactEmail?.message}>
            <Input type="email" {...fieldAria('org-email', errors.contactEmail?.message)} {...form.register('contactEmail')} />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="org-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            {editing ? 'Save changes' : 'Create organisation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrganisationsContent() {
  const [dialog, setDialog] = useState<{ open: boolean; editing: OrganisationDto | null }>({ open: false, editing: null });
  const invalidate = useInvalidateDirectory();

  const columns: Column<OrganisationDto>[] = [
    { key: 'name', header: 'Organisation', cell: (o) => <><div className="font-medium">{o.name}</div><div className="text-xs text-muted-foreground">{o.code}</div></> },
    { key: 'state', header: 'State', cell: (o) => o.state },
    { key: 'contact', header: 'Contact', className: 'hidden md:table-cell', cell: (o) => o.contactEmail ?? '—' },
    { key: 'status', header: 'Status', cell: (o) => <RecordStatusBadge status={o.status} /> },
    { key: 'updated', header: 'Updated', className: 'hidden lg:table-cell text-muted-foreground', cell: (o) => formatDateTime(o.updatedAt) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-12',
      cell: (o) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${o.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialog({ open: true, editing: o })}><Pencil aria-hidden /> Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
            <StatusMenuItem name={o.name} kind="organisation" status={o.status} onChange={async (status) => { await api.organisations.update(o.id, { status, version: o.version }); await invalidate('organisations'); }} />
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Organisations"
        description="Programmes using CARETRAIL. Each organisation's data is isolated from the others."
        actions={<Button className="h-9" onClick={() => setDialog({ open: true, editing: null })}><Plus aria-hidden /> New organisation</Button>}
      />
      <ReferenceList
        resource="organisations"
        fetcher={api.organisations.list}
        columns={columns}
        searchLabel="Search organisations"
        empty={{ icon: Building2, title: 'No organisations yet', description: 'Create the first programme organisation.' }}
      />
      <OrganisationDialog open={dialog.open} editing={dialog.editing} onClose={() => setDialog({ open: false, editing: null })} />
    </>
  );
}

export function OrganisationsPage() {
  return (
    <RequirePermission permission="organisation:manage">
      <OrganisationsContent />
    </RequirePermission>
  );
}
