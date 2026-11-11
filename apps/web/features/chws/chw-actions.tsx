'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Eye, KeyRound, MoreHorizontal, Pencil, UserCheck, UserX } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ChwDto } from '@caretrail/shared-types';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { errorMessage } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCan } from '@/features/auth/session-store';
import type { IssuedLinkInfo } from '@/features/users/issued-link-dialog';
import { api } from '@/services/api';

/** Row/detail actions for a CHW. Account access changes go through the /users endpoints. */
export function ChwActions({
  chw,
  onEdit,
  onLinkIssued,
  showView = true,
}: {
  chw: ChwDto;
  onEdit: () => void;
  onLinkIssued: (info: IssuedLinkInfo) => void;
  showView?: boolean;
}) {
  const qc = useQueryClient();
  const canManage = useCan('chw:manage');
  const canManageAccounts = useCan('user:manage');
  const [confirm, setConfirm] = useState(false);
  const active = chw.user.status === 'active';

  const issueLink = async () => {
    try {
      const link = await api.users.issuePasswordLink(chw.id);
      onLinkIssued({ link, userName: chw.user.fullName, kind: chw.user.status === 'pending_activation' ? 'activation' : 'reset' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${chw.user.fullName}`}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showView && (
            <DropdownMenuItem asChild><Link href={`/chws/${chw.id}`}><Eye aria-hidden /> View details</Link></DropdownMenuItem>
          )}
          {canManage && <DropdownMenuItem onSelect={onEdit}><Pencil aria-hidden /> Edit programme profile</DropdownMenuItem>}
          {canManageAccounts && chw.user.status !== 'inactive' && (
            <DropdownMenuItem onSelect={issueLink}>
              <KeyRound aria-hidden /> {chw.user.status === 'pending_activation' ? 'New activation link' : 'Issue password reset link'}
            </DropdownMenuItem>
          )}
          {canManageAccounts && chw.user.status !== 'pending_activation' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant={active ? 'destructive' : 'default'} onSelect={(e) => { e.preventDefault(); setConfirm(true); }}>
                {active ? <><UserX aria-hidden /> Deactivate account</> : <><UserCheck aria-hidden /> Reactivate account</>}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={active ? 'Deactivate this health worker?' : 'Reactivate this health worker?'}
        description={
          active
            ? `${chw.user.fullName} will be signed out of the mobile app immediately and cannot sign in. Their records are kept. Any work not yet synced from their phone will not reach the server until they are reactivated.`
            : `${chw.user.fullName} will be able to sign in again.`
        }
        confirmLabel={active ? 'Deactivate' : 'Reactivate'}
        destructive={active}
        onConfirm={async () => {
          try {
            await api.users.setStatus(chw.id, active ? 'inactive' : 'active', chw.user.version);
            toast.success(active ? 'Account deactivated' : 'Account reactivated');
            await qc.invalidateQueries({ queryKey: ['chws'] });
            await qc.invalidateQueries({ queryKey: ['overview'] });
          } catch (err) {
            toast.error(errorMessage(err));
            await qc.invalidateQueries({ queryKey: ['chws'] });
            throw err;
          }
        }}
      />
    </>
  );
}
