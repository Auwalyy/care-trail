'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, KeyRound, MoreHorizontal, Pencil, Search, UserCheck, UserX, Users as UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@caretrail/api-client';
import { ROLES, ROLE_LABELS, USER_STATUSES, canManageRole, type Role, type UserDto, type UserStatus } from '@caretrail/shared-types';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, TableSkeleton, errorMessage } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RequirePermission } from '@/features/auth/require-session';
import { useCan, useSession } from '@/features/auth/session-store';
import { useCommunities, useFacilities, useOrganisations } from '@/features/directory/use-directory';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';
import { CreateUserDialog } from './create-user-dialog';
import { EditUserDialog } from './edit-user-dialog';
import { IssuedLinkDialog, type IssuedLinkInfo } from './issued-link-dialog';
import { STATUS_BADGE, STATUS_LABELS, formatDateTime } from './labels';

const ALL = '__all__';
const PAGE_SIZE = 20;

function useAssignmentLabel() {
  const orgs = useOrganisations();
  const facilities = useFacilities();
  const communities = useCommunities();
  return (u: UserDto) => {
    const parts: string[] = [];
    if (u.facilityId) parts.push(facilities.names.get(u.facilityId) ?? 'Facility');
    if (u.communityIds.length) parts.push(u.communityIds.map((id) => communities.names.get(id) ?? 'Community').join(', '));
    if (!parts.length && u.organisationId) parts.push(orgs.names.get(u.organisationId) ?? 'Organisation');
    return parts.join(' · ') || (u.role === 'platform_admin' ? 'Platform' : '—');
  };
}

function StatusConfirmDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const deactivating = user?.status !== 'inactive';
  const mutation = useMutation({
    mutationFn: (u: UserDto) => api.users.setStatus(u.id, deactivating ? 'inactive' : 'active', u.version),
    onSuccess: async (u) => {
      toast.success(u.status === 'inactive' ? `${u.fullName} has been deactivated and signed out everywhere.` : `${u.fullName} has been reactivated.`);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: async (err) => {
      toast.error(err instanceof ApiError && err.code === 'VERSION_CONFLICT' ? 'This user was changed by someone else. Please try again.' : errorMessage(err));
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  return (
    <Dialog open={user !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{deactivating ? 'Deactivate user?' : 'Reactivate user?'}</DialogTitle>
          <DialogDescription>
            {deactivating
              ? `${user?.fullName} will be signed out on every device immediately and will not be able to sign in. Their records are kept.`
              : `${user?.fullName} will be able to sign in again.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={deactivating ? 'destructive' : 'default'} disabled={mutation.isPending} onClick={() => user && mutation.mutate(user)}>
            {deactivating ? 'Deactivate' : 'Reactivate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsersTable() {
  const me = useSession((s) => s.user)!;
  const canManage = useCan('user:manage');
  const assignment = useAssignmentLabel();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | typeof ALL>(ALL);
  const [status, setStatus] = useState<UserStatus | typeof ALL>(ALL);
  const q = useDebouncedValue(search.trim());
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [statusTarget, setStatusTarget] = useState<UserDto | null>(null);
  const [issued, setIssued] = useState<IssuedLinkInfo | null>(null);

  const params = { page, pageSize: PAGE_SIZE, ...(q ? { q } : {}), ...(role !== ALL ? { role } : {}), ...(status !== ALL ? { status } : {}) };
  const query = useQuery({ queryKey: ['users', params], queryFn: () => api.users.list(params), placeholderData: keepPreviousData });

  const linkMutation = useMutation({
    mutationFn: (u: UserDto) => api.users.issuePasswordLink(u.id),
    onSuccess: (link, u) => setIssued({ link, userName: u.fullName, kind: u.status === 'pending_activation' ? 'activation' : 'reset' }),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const manageable = (u: UserDto) => canManage && u.id !== me.id && canManageRole(me.role, u.role);
  const filtersActive = Boolean(q) || role !== ALL || status !== ALL;
  const meta = query.data?.meta;

  return (
    <>
      <PageHeader
        title="Users"
        description="People who can sign in to CARETRAIL within your area of responsibility."
        actions={<CreateUserDialog onCreated={setIssued} />}
      />
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by name or email" className="h-9 ps-9" aria-label="Search users" />
          </div>
          <Select value={role} onValueChange={(v) => { setRole(v as Role | typeof ALL); setPage(1); }}>
            <SelectTrigger className="h-9 sm:w-52" aria-label="Filter by role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v as UserStatus | typeof ALL); setPage(1); }}>
            <SelectTrigger className="h-9 sm:w-48" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {USER_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {query.isPending ? (
          <TableSkeleton cols={5} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data.data.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title={filtersActive ? 'No users match these filters' : 'No users yet'}
            {...(filtersActive ? { description: 'Try a different search or clear the filters.' } : canManage ? { description: 'Add the first user to get started.' } : {})}
          />
        ) : (
          <div className={cn('overflow-x-auto', query.isFetching && 'opacity-70 transition-opacity')}>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="ps-4">Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden lg:table-cell">Assignment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Last sign-in</TableHead>
                  <TableHead className="w-12 pe-4"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="ps-4">
                      <div className="font-medium">{u.fullName}{u.id === me.id && <span className="ms-2 text-xs text-muted-foreground">(you)</span>}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{ROLE_LABELS[u.role]}</TableCell>
                    <TableCell className="hidden max-w-64 truncate text-muted-foreground lg:table-cell">{assignment(u)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_BADGE[u.status]}>{STATUS_LABELS[u.status]}</Badge>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{formatDateTime(u.lastLoginAt)}</TableCell>
                    <TableCell className="pe-4">
                      {manageable(u) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Actions for ${u.fullName}`}><MoreHorizontal /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(u)}><Pencil aria-hidden /> Edit</DropdownMenuItem>
                            {u.status !== 'inactive' && (
                              <DropdownMenuItem onSelect={() => linkMutation.mutate(u)}>
                                <KeyRound aria-hidden /> {u.status === 'pending_activation' ? 'New activation link' : 'Issue password reset link'}
                              </DropdownMenuItem>
                            )}
                            {u.status !== 'pending_activation' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant={u.status === 'active' ? 'destructive' : 'default'} onSelect={() => setStatusTarget(u)}>
                                  {u.status === 'active' ? <><UserX aria-hidden /> Deactivate</> : <><UserCheck aria-hidden /> Reactivate</>}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between gap-4 border-t px-4 py-3 text-sm">
            <p className="text-muted-foreground">
              {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft aria-hidden /> Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight aria-hidden /></Button>
            </div>
          </div>
        )}
      </Card>

      <EditUserDialog user={editing} onClose={() => setEditing(null)} />
      <StatusConfirmDialog user={statusTarget} onClose={() => setStatusTarget(null)} />
      <IssuedLinkDialog info={issued} onClose={() => setIssued(null)} />
    </>
  );
}

export function UsersPage() {
  return (
    <RequirePermission permission="user:read">
      <UsersTable />
    </RequirePermission>
  );
}
