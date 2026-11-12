'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, BadgeCheck, BookOpen, EyeOff, Loader2, MoreHorizontal, Music, Pencil, Plus, Send, Trash2, Undo2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError, type EducationTransitionBody } from '@caretrail/api-client';
import {
  AUDIO_CONTENT_TYPES,
  EDUCATION_CATEGORIES,
  EDUCATION_CATEGORY_LABELS,
  EDUCATION_STATUS_LABELS,
  MAX_AUDIO_BYTES,
  type EducationCategory,
  type EducationContentDto,
  type EducationStatus,
  type Language,
} from '@caretrail/shared-types';
import { DataTable, type Column } from '@/components/data/data-table';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, errorMessage } from '@/components/states/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { RequirePermission, useHasPermission } from '@/features/auth/require-session';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { formatDate } from '@/features/patients/patient-labels';
import { formatDateTime } from '@/features/users/labels';
import { api } from '@/services/api';

const STATUS_STYLE: Record<EducationStatus, string> = {
  draft: 'border-warning-700/20 bg-warning-50 text-warning-700',
  in_review: 'border-brand-700/20 bg-brand-50 text-brand-700',
  approved: 'border-success-700/20 bg-success-50 text-success-700',
  published: 'border-success-700/30 bg-success-700 text-white',
  archived: 'bg-muted text-ink-muted',
};
const StatusBadge = ({ status }: { status: EducationStatus }) => <Badge variant="outline" className={STATUS_STYLE[status]}>{EDUCATION_STATUS_LABELS[status]}</Badge>;

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
      await qc.invalidateQueries({ queryKey: ['education'] });
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

function EditDialog({ editing, organisationId, onClose }: { editing: EducationContentDto | null; organisationId: string | null; onClose: () => void }) {
  const [category, setCategory] = useState<EducationCategory>(editing?.category ?? 'antenatal_care');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [titleHa, setTitleHa] = useState(editing?.titleHa ?? '');
  const [bodyHa, setBodyHa] = useState(editing?.bodyHa ?? '');
  const { busy, errors, save } = useSave(onClose);
  const values = { category, title, body, titleHa: titleHa || null, bodyHa: bodyHa || null };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit content' : 'New education content'}</DialogTitle>
          <DialogDescription>Written by your programme. It reaches health workers only after a clinical reviewer has approved it and it has been published.</DialogDescription>
        </DialogHeader>
        {editing && editing.status !== 'draft' && <Alert><AlertDescription>Saving changes returns this item to draft. It is taken off health workers’ phones until it has been reviewed and published again.</AlertDescription></Alert>}
        {errors._ && <Alert variant="destructive"><AlertDescription>{errors._}</AlertDescription></Alert>}
        <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
          <Field id="e-cat" label="Category" error={errors.category}>
            <Select value={category} onValueChange={(v) => setCategory(v as EducationCategory)}>
              <SelectTrigger id="e-cat" className="sm:w-72"><SelectValue /></SelectTrigger>
              <SelectContent>{EDUCATION_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{EDUCATION_CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field id="e-title" label="Title (English)" error={errors.title}><Input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field id="e-body" label="Text (English)" error={errors.body}><Textarea id="e-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <Field id="e-title-ha" label="Title (Hausa, optional)" error={errors.titleHa}><Input id="e-title-ha" lang="ha" value={titleHa} onChange={(e) => setTitleHa(e.target.value)} /></Field>
          <Field id="e-body-ha" label="Text (Hausa, optional)" error={errors.bodyHa} hint="Use a reviewed translation, never machine translation. Give both Hausa fields or neither.">
            <Textarea id="e-body-ha" lang="ha" rows={6} value={bodyHa} onChange={(e) => setBodyHa(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={() =>
              save(
                () => (editing ? api.education.update(editing.id, { ...values, version: editing.version }) : api.education.create({ ...values, ...(organisationId ? { organisationId } : {}) })),
                editing ? 'Content saved' : 'Draft created',
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

function ReviewDialog({ item, mode, onClose }: { item: EducationContentDto; mode: 'approve' | 'return'; onClose: () => void }) {
  const [reviewerName, setName] = useState('');
  const [reviewerCredentials, setCreds] = useState('');
  const [approvedOn, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const { busy, errors, save } = useSave(onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'approve' ? 'Record clinical approval' : 'Return to author'}</DialogTitle>
          <DialogDescription>
            {mode === 'approve' ? 'Record who reviewed this content. Only do this once a qualified clinician has approved the exact text (and audio) below.' : 'Say what needs to change. The author sees your note.'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg bg-muted p-3 text-sm">
          <p className="font-medium">{item.title}</p>
          <p className="whitespace-pre-line">{item.body}</p>
          {item.bodyHa && <><p lang="ha" className="font-medium">{item.titleHa}</p><p lang="ha" className="whitespace-pre-line text-muted-foreground">{item.bodyHa}</p></>}
          {(item.audio.en || item.audio.ha) && <p className="text-muted-foreground">Audio attached: {[item.audio.en && 'English', item.audio.ha && 'Hausa'].filter(Boolean).join(', ')}. Listen to it before approving.</p>}
        </div>
        {errors._ && <Alert variant="destructive"><AlertDescription>{errors._}</AlertDescription></Alert>}
        {mode === 'approve' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="r-name" label="Reviewer’s name" error={errors.reviewerName}><Input id="r-name" value={reviewerName} onChange={(e) => setName(e.target.value)} /></Field>
            <Field id="r-creds" label="Qualification" error={errors.reviewerCredentials}><Input id="r-creds" value={reviewerCredentials} onChange={(e) => setCreds(e.target.value)} placeholder="e.g. Registered Midwife" /></Field>
            <Field id="r-date" label="Approved on" error={errors.approvedOn}><Input id="r-date" type="date" value={approvedOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
        ) : (
          <Field id="r-note" label="What needs to change" error={errors.note}><Textarea id="r-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={() =>
              save(
                () => api.education.transition(item.id, mode === 'approve' ? { action: 'approve', reviewerName, reviewerCredentials, approvedOn, version: item.version } : { action: 'return', note, version: item.version }),
                mode === 'approve' ? 'Approval recorded — it can now be published' : 'Returned to the author',
              )
            }
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}{mode === 'approve' ? 'Record approval' : 'Return'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Plays stored audio through an authenticated request (the file is not publicly reachable). */
function AudioPlayer({ id, lang, version }: { id: string; lang: Language; version: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    api.education
      .audio(id, lang)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, lang, version]);
  if (error) return <p className="text-sm text-danger-700">{error}</p>;
  if (!url) return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading audio" />;
  return <audio controls src={url} className="h-9 w-full max-w-sm" />;
}

function AudioDialog({ item, onClose }: { item: EducationContentDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState(item);
  const [busy, setBusy] = useState<Language | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = { en: useRef<HTMLInputElement>(null), ha: useRef<HTMLInputElement>(null) };
  const run = async (lang: Language, fn: () => Promise<EducationContentDto>, done: string) => {
    setBusy(lang);
    setError(null);
    try {
      setCurrent(await fn());
      toast.success(done);
      await qc.invalidateQueries({ queryKey: ['education'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const onFile = (lang: Language, file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_AUDIO_BYTES) return setError('Audio files can be at most 10 MB.');
    if (!(AUDIO_CONTENT_TYPES as readonly string[]).includes(file.type)) return setError(`Unsupported file type. Use MP3, M4A, AAC, OGG, WAV or WebM.`);
    void run(lang, () => api.education.uploadAudio(current.id, lang, file, current.version), 'Audio uploaded');
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Audio for “{current.title}”</DialogTitle>
          <DialogDescription>Recorded readings for people who prefer listening. Changing audio returns reviewed content to draft.</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {(['en', 'ha'] as const).map((lang) => {
          const audio = current.audio[lang];
          const disabled = busy !== null || current.status === 'archived' || (lang === 'ha' && !current.bodyHa);
          return (
            <div key={lang} className="grid gap-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{lang === 'en' ? 'English' : 'Hausa'}</span>
                {audio && <span className="text-xs text-muted-foreground">{(audio.size / 1024 / 1024).toFixed(1)} MB · {formatDateTime(audio.uploadedAt)}</span>}
              </div>
              {audio ? <AudioPlayer id={current.id} lang={lang} version={current.version} /> : <p className="text-sm text-muted-foreground">{lang === 'ha' && !current.bodyHa ? 'Add the Hausa text first.' : 'No audio yet.'}</p>}
              <input ref={inputs[lang]} type="file" accept={AUDIO_CONTENT_TYPES.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => { onFile(lang, e.target.files?.[0]); e.target.value = ''; }} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={disabled} onClick={() => inputs[lang].current?.click()}>
                  {busy === lang ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}{audio ? 'Replace' : 'Upload'}
                </Button>
                {audio && (
                  <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void run(lang, () => api.education.deleteAudio(current.id, lang, current.version), 'Audio removed')}>
                    <Trash2 aria-hidden /> Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy !== null}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EducationContent() {
  const qc = useQueryClient();
  const canManage = useHasPermission('education:manage');
  const canReview = useHasPermission('education:approve');
  const { isPlatform, organisationId } = useActiveOrganisation();
  const [status, setStatus] = useState<EducationStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<EducationContentDto | null | 'new'>(null);
  const [reviewing, setReviewing] = useState<{ item: EducationContentDto; mode: 'approve' | 'return' } | null>(null);
  const [audioFor, setAudioFor] = useState<EducationContentDto | null>(null);
  const needsOrg = isPlatform && !organisationId;
  const params = { page, pageSize: 25, ...(status !== 'all' ? { status } : {}), ...(isPlatform && organisationId ? { organisationId } : {}) };
  const query = useQuery({ queryKey: ['education', params], queryFn: () => api.education.list(params), placeholderData: keepPreviousData, enabled: !needsOrg });

  const step = async (item: EducationContentDto, body: EducationTransitionBody, done: string) => {
    try {
      await api.education.transition(item.id, body);
      toast.success(done);
      await qc.invalidateQueries({ queryKey: ['education'] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const columns: Column<EducationContentDto>[] = [
    {
      key: 'title',
      header: 'Content',
      cell: (e) => (
        <>
          <div className="font-medium">{e.title}</div>
          <div className="text-xs text-muted-foreground">{EDUCATION_CATEGORY_LABELS[e.category]}</div>
          {e.status === 'draft' && e.reviewNote && <div className="mt-1 max-w-md text-xs text-warning-700">Reviewer: {e.reviewNote}</div>}
        </>
      ),
    },
    { key: 'langs', header: 'Languages', className: 'hidden md:table-cell', cell: (e) => <span className="text-sm">{e.bodyHa ? 'English, Hausa' : 'English'}{(e.audio.en || e.audio.ha) && <Music className="ml-1 inline size-3.5 text-muted-foreground" aria-label="has audio" />}</span> },
    { key: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.status} /> },
    { key: 'approval', header: 'Reviewed by', className: 'hidden lg:table-cell', cell: (e) => (e.approval ? <><div>{e.approval.reviewerName}</div><div className="text-xs text-muted-foreground">{e.approval.reviewerCredentials} · {formatDate(e.approval.approvedOn)}</div></> : '—') },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-12',
      cell: (e) =>
        e.status !== 'archived' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${e.title}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canManage && <DropdownMenuItem onSelect={() => setEditing(e)}><Pencil aria-hidden /> Edit</DropdownMenuItem>}
              {canManage && <DropdownMenuItem onSelect={() => setAudioFor(e)}><Music aria-hidden /> Audio</DropdownMenuItem>}
              {canManage && e.status === 'draft' && <DropdownMenuItem onSelect={() => void step(e, { action: 'submit', version: e.version }, 'Sent for clinical review')}><Send aria-hidden /> Send for review</DropdownMenuItem>}
              {canReview && e.status === 'in_review' && <DropdownMenuItem onSelect={() => setReviewing({ item: e, mode: 'approve' })}><BadgeCheck aria-hidden /> Record clinical approval</DropdownMenuItem>}
              {canReview && e.status === 'in_review' && <DropdownMenuItem onSelect={() => setReviewing({ item: e, mode: 'return' })}><Undo2 aria-hidden /> Return to author</DropdownMenuItem>}
              {canManage && e.status === 'approved' && <DropdownMenuItem onSelect={() => void step(e, { action: 'publish', version: e.version }, 'Published — health workers receive it at their next sync')}><BookOpen aria-hidden /> Publish</DropdownMenuItem>}
              {canManage && e.status === 'published' && <DropdownMenuItem onSelect={() => void step(e, { action: 'unpublish', version: e.version }, 'Unpublished')}><EyeOff aria-hidden /> Unpublish</DropdownMenuItem>}
              {canManage && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => void step(e, { action: 'archive', version: e.version }, 'Archived')}><Archive aria-hidden /> Archive</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Health education"
        description="Programme-written guidance for health workers and families. CARETRAIL provides none: every item needs a recorded clinical review before it can be published."
        actions={<><OrganisationPicker />{!needsOrg && canManage && <Button className="h-9" onClick={() => setEditing('new')}><Plus aria-hidden /> New content</Button>}</>}
      />
      {needsOrg ? (
        <EmptyState icon={BookOpen} title="Choose an organisation" />
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="overflow-x-auto border-b p-4">
            <Tabs value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(1); }}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="draft">Drafts</TabsTrigger>
                <TabsTrigger value="in_review">In review</TabsTrigger>
                <TabsTrigger value="approved">Approved</TabsTrigger>
                <TabsTrigger value="published">Published</TabsTrigger>
                <TabsTrigger value="archived">Archived</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <DataTable
            columns={columns}
            rows={query.data?.data}
            rowKey={(e) => e.id}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            onRetry={() => query.refetch()}
            empty={{ icon: BookOpen, title: 'No content yet', description: 'Write content with your clinical lead, send it for review, then publish it.' }}
            meta={query.data?.meta}
            onPageChange={setPage}
          />
        </Card>
      )}
      {editing && <EditDialog editing={editing === 'new' ? null : editing} organisationId={isPlatform ? organisationId : null} onClose={() => setEditing(null)} />}
      {reviewing && <ReviewDialog item={reviewing.item} mode={reviewing.mode} onClose={() => setReviewing(null)} />}
      {audioFor && <AudioDialog item={audioFor} onClose={() => setAudioFor(null)} />}
    </>
  );
}

export function EducationPage() {
  return (
    <RequirePermission permission="education:read">
      <EducationContent />
    </RequirePermission>
  );
}
