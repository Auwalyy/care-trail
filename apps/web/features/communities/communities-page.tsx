'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, MapPinned, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import type { CommunityDto } from '@caretrail/shared-types';
import { createCommunitySchema } from '@caretrail/validation';
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
import { RequirePermission } from '@/features/auth/require-session';
import { useCan } from '@/features/auth/session-store';
import { ReferenceList } from '@/features/directory/reference-list';
import { StatusMenuItem } from '@/features/directory/status-action';
import { useInvalidateDirectory } from '@/features/directory/use-directory';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { api } from '@/services/api';

const schema = createCommunitySchema.omit({ organisationId: true });
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

function CommunityDialog({ editing, open, organisationId, onClose }: { editing: CommunityDto | null; open: boolean; organisationId: string | null; onClose: () => void }) {
  const invalidate = useInvalidateDirectory();
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema) });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (open) form.reset(editing ? { name: editing.name, lga: editing.lga, ward: editing.ward ?? '' } : { name: '', lga: '', ward: '' });
  }, [open, editing, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      if (editing) await api.communities.update(editing.id, { ...v, version: editing.version });
      else await api.communities.create({ ...v, organisationId });
      toast.success(editing ? 'Community updated' : 'Community added');
      await invalidate('communities');
      onClose();
    } catch (err) {
      applyApiErrors(err, form.setError, ['name', 'lga', 'ward']);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit community' : 'Add community'}</DialogTitle>
          <DialogDescription>Communities are the catchment areas community health workers serve.</DialogDescription>
        </DialogHeader>
        <form id="community-form" onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormField id="com-name" label="Community name" error={errors.name?.message}>
            <Input {...fieldAria('com-name', errors.name?.message)} {...form.register('name')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="com-lga" label="LGA" error={errors.lga?.message}>
              <Input {...fieldAria('com-lga', errors.lga?.message)} {...form.register('lga')} />
            </FormField>
            <FormField id="com-ward" label="Ward (optional)" error={errors.ward?.message}>
              <Input {...fieldAria('com-ward', errors.ward?.message)} {...form.register('ward')} />
            </FormField>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="community-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            {editing ? 'Save changes' : 'Add community'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommunitiesContent() {
  const canManage = useCan('community:manage');
  const { isPlatform, organisationId } = useActiveOrganisation();
  const [dialog, setDialog] = useState<{ open: boolean; editing: CommunityDto | null }>({ open: false, editing: null });
  const invalidate = useInvalidateDirectory();
  const needsOrg = isPlatform && !organisationId;

  const columns: Column<CommunityDto>[] = [
    { key: 'name', header: 'Community', cell: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'lga', header: 'LGA', cell: (c) => c.lga },
    { key: 'ward', header: 'Ward', className: 'hidden md:table-cell', cell: (c) => c.ward ?? '—' },
    { key: 'status', header: 'Status', cell: (c) => <RecordStatusBadge status={c.status} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-12',
      cell: (c) =>
        canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${c.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog({ open: true, editing: c })}><Pencil aria-hidden /> Edit</DropdownMenuItem>
              <DropdownMenuSeparator />
              <StatusMenuItem name={c.name} kind="community" status={c.status} onChange={async (status) => { await api.communities.update(c.id, { status, version: c.version }); await invalidate('communities'); }} />
            </DropdownMenuContent>
          </DropdownMenu>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Communities"
        description="Catchment areas served by community health workers."
        actions={
          <>
            <OrganisationPicker />
            {canManage && !needsOrg && <Button className="h-9" onClick={() => setDialog({ open: true, editing: null })}><Plus aria-hidden /> Add community</Button>}
          </>
        }
      />
      {needsOrg ? (
        <EmptyState icon={MapPinned} title="Choose an organisation" description="Select an organisation above to see and manage its communities." />
      ) : (
        <ReferenceList
          key={organisationId ?? 'own'}
          resource="communities"
          fetcher={api.communities.list}
          organisationId={isPlatform ? organisationId : undefined}
          columns={columns}
          searchLabel="Search by name, LGA or ward"
          empty={{ icon: MapPinned, title: 'No communities yet', ...(canManage ? { description: 'Add the communities your health workers serve.' } : {}) }}
        />
      )}
      <CommunityDialog open={dialog.open} editing={dialog.editing} organisationId={isPlatform ? organisationId : null} onClose={() => setDialog({ open: false, editing: null })} />
    </>
  );
}

export function CommunitiesPage() {
  return (
    <RequirePermission permission="community:read">
      <CommunitiesContent />
    </RequirePermission>
  );
}
