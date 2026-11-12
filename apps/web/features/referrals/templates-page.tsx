'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, BadgeCheck, FileText, Loader2, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@caretrail/api-client';
import type { InstructionTemplateDto, TemplateStatus } from '@caretrail/shared-types';
import { DataTable, type Column } from '@/components/data/data-table';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, errorMessage } from '@/components/states/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { RequirePermission } from '@/features/auth/require-session';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { formatDate } from '@/features/patients/patient-labels';
import { api } from '@/services/api';

const STATUS_BADGE: Record<TemplateStatus, ReactNode> = {
  draft: <Badge variant="outline" className="border-warning-700/20 bg-warning-50 text-warning-700">Awaiting clinical approval</Badge>,
  approved: <Badge variant="outline" className="border-success-700/20 bg-success-50 text-success-700">Approved</Badge>,
  retired: <Badge variant="outline" className="bg-muted text-ink-muted">Retired</Badge>,
};

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string | undefined; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p role="alert" className="text-sm text-danger-700">{error}</p> : hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function useSave(onDone: () => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      toast.success(success);
      await qc.invalidateQueries({ queryKey: ['referral-templates'] });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.path ?? '_', f.message])));
      else setErrors({ _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, save };
}

function TemplateDialog({ editing, organisationId, onClose }: { editing: InstructionTemplateDto | null; organisationId: string | null; onClose: () => void }) {
  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [bodyHa, setBodyHa] = useState(editing?.bodyHa ?? '');
  const { busy, errors, save } = useSave(onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit instruction' : 'New instruction'}</DialogTitle>
          <DialogDescription>Plain, practical guidance for the patient. It cannot be used until a qualified clinician has approved it.</DialogDescription>
        </DialogHeader>
        {editing?.status === 'approved' && <Alert><AlertDescription>Changing the wording sends this instruction back for clinical approval.</AlertDescription></Alert>}
        {errors._ && <Alert variant="destructive"><AlertDescription>{errors._}</AlertDescription></Alert>}
        <div className="grid gap-4">
          <Field id="t-title" label="Title" error={errors.title}><Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field id="t-body" label="Instruction (English)" error={errors.body}><Textarea id="t-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <Field id="t-ha" label="Instruction (Hausa, optional)" error={errors.bodyHa} hint="Use a reviewed translation, not machine translation.">
            <Textarea id="t-ha" lang="ha" rows={4} value={bodyHa} onChange={(e) => setBodyHa(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={() =>
              save(
                () =>
                  editing
                    ? api.referralTemplates.update(editing.id, { title, body, bodyHa: bodyHa || null, version: editing.version })
                    : api.referralTemplates.create({ title, body, bodyHa: bodyHa || null, ...(organisationId ? { organisationId } : {}) }),
                editing ? 'Instruction updated' : 'Instruction created — it now needs clinical approval',
              )
            }
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApproveDialog({ template, onClose }: { template: InstructionTemplateDto; onClose: () => void }) {
  const [reviewerName, setName] = useState('');
  const [reviewerCredentials, setCreds] = useState('');
  const [approvedOn, setDate] = useState(new Date().toISOString().slice(0, 10));
  const { busy, errors, save } = useSave(onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record clinical approval</DialogTitle>
          <DialogDescription>Record who reviewed “{template.title}”. Only do this once a qualified clinician has approved the exact wording below.</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-muted p-3 text-sm">
          <p className="whitespace-pre-line">{template.body}</p>
          {template.bodyHa && <p lang="ha" className="mt-2 whitespace-pre-line text-muted-foreground">{template.bodyHa}</p>}
        </div>
        {errors._ && <Alert variant="destructive"><AlertDescription>{errors._}</AlertDescription></Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="a-name" label="Reviewer's name" error={errors.reviewerName}><Input id="a-name" value={reviewerName} onChange={(e) => setName(e.target.value)} /></Field>
          <Field id="a-creds" label="Qualification" error={errors.reviewerCredentials}><Input id="a-creds" value={reviewerCredentials} onChange={(e) => setCreds(e.target.value)} placeholder="e.g. Registered Midwife" /></Field>
          <Field id="a-date" label="Approved on" error={errors.approvedOn}><Input id="a-date" type="date" value={approvedOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy} onClick={() => save(() => api.referralTemplates.approve(template.id, { reviewerName, reviewerCredentials, approvedOn, version: template.version }), 'Approval recorded — the instruction can now be used')}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}Record approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplatesContent() {
  const qc = useQueryClient();
  const { isPlatform, organisationId } = useActiveOrganisation();
  const [status, setStatus] = useState<TemplateStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<InstructionTemplateDto | null | 'new'>(null);
  const [approving, setApproving] = useState<InstructionTemplateDto | null>(null);
  const [retiring, setRetiring] = useState<InstructionTemplateDto | null>(null);
  const needsOrg = isPlatform && !organisationId;
  const params = { page, pageSize: 50, ...(status !== 'all' ? { status } : {}), ...(isPlatform && organisationId ? { organisationId } : {}) };
  const query = useQuery({ queryKey: ['referral-templates', params], queryFn: () => api.referralTemplates.list(params), placeholderData: keepPreviousData, enabled: !needsOrg });

  const columns: Column<InstructionTemplateDto>[] = [
    { key: 'title', header: 'Instruction', cell: (t) => <><div className="font-medium">{t.title}</div><div className="line-clamp-1 max-w-md text-xs text-muted-foreground">{t.body}</div></> },
    { key: 'ha', header: 'Hausa', className: 'hidden md:table-cell', cell: (t) => (t.bodyHa ? 'Yes' : <span className="text-muted-foreground">No</span>) },
    { key: 'status', header: 'Status', cell: (t) => STATUS_BADGE[t.status] },
    { key: 'approval', header: 'Approved by', className: 'hidden lg:table-cell', cell: (t) => (t.approval ? <><div>{t.approval.reviewerName}</div><div className="text-xs text-muted-foreground">{t.approval.reviewerCredentials} · {formatDate(t.approval.approvedOn)}</div></> : '—') },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-12',
      cell: (t) =>
        t.status !== 'retired' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${t.title}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(t)}><Pencil aria-hidden /> Edit</DropdownMenuItem>
              {t.status === 'draft' && <DropdownMenuItem onSelect={() => setApproving(t)}><BadgeCheck aria-hidden /> Record clinical approval</DropdownMenuItem>}
              <DropdownMenuItem variant="destructive" onSelect={() => setRetiring(t)}><Archive aria-hidden /> Retire</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Referral instructions"
        description="Approved guidance that can be attached to referrals and printed on receipts. CARETRAIL provides none; all wording comes from your programme and its clinical reviewers."
        actions={<><OrganisationPicker />{!needsOrg && <Button className="h-9" onClick={() => setEditing('new')}><Plus aria-hidden /> New instruction</Button>}</>}
      />
      {needsOrg ? (
        <EmptyState icon={FileText} title="Choose an organisation" />
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="border-b p-4">
            <Tabs value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(1); }}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="draft">Awaiting approval</TabsTrigger>
                <TabsTrigger value="approved">Approved</TabsTrigger>
                <TabsTrigger value="retired">Retired</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <DataTable
            columns={columns}
            rows={query.data?.data}
            rowKey={(t) => t.id}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            onRetry={() => query.refetch()}
            empty={{ icon: FileText, title: 'No instructions yet', description: 'Write instructions with your clinical lead, then record their approval here.' }}
            meta={query.data?.meta}
            onPageChange={setPage}
          />
        </Card>
      )}
      {editing && <TemplateDialog editing={editing === 'new' ? null : editing} organisationId={isPlatform ? organisationId : null} onClose={() => setEditing(null)} />}
      {approving && <ApproveDialog template={approving} onClose={() => setApproving(null)} />}
      <ConfirmDialog
        open={retiring !== null}
        onClose={() => setRetiring(null)}
        title="Retire this instruction?"
        description="It can no longer be attached to new referrals. Referrals already issued keep the wording they were given."
        confirmLabel="Retire"
        destructive
        onConfirm={async () => {
          try {
            await api.referralTemplates.update(retiring!.id, { status: 'retired', version: retiring!.version });
            toast.success('Instruction retired');
            await qc.invalidateQueries({ queryKey: ['referral-templates'] });
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </>
  );
}

export function TemplatesPage() {
  return (
    <RequirePermission permission="referral:manage-templates">
      <TemplatesContent />
    </RequirePermission>
  );
}
