'use client';

import { Power, PowerOff } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { RecordStatus } from '@caretrail/shared-types';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { errorMessage } from '@/components/states/states';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

/** Deactivate / reactivate menu item with confirmation. The API refuses unsafe deactivations. */
export function StatusMenuItem({
  name,
  kind,
  status,
  onChange,
}: {
  name: string;
  kind: string;
  status: RecordStatus;
  onChange: (next: RecordStatus) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const deactivating = status === 'active';
  return (
    <>
      <DropdownMenuItem variant={deactivating ? 'destructive' : 'default'} onSelect={(e) => { e.preventDefault(); setOpen(true); }}>
        {deactivating ? <PowerOff aria-hidden /> : <Power aria-hidden />}
        {deactivating ? 'Deactivate' : 'Reactivate'}
      </DropdownMenuItem>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${deactivating ? 'Deactivate' : 'Reactivate'} ${kind}?`}
        description={
          deactivating
            ? `${name} will no longer be available for new assignments. Existing records are kept.`
            : `${name} will be available again.`
        }
        confirmLabel={deactivating ? 'Deactivate' : 'Reactivate'}
        destructive={deactivating}
        onConfirm={async () => {
          try {
            await onChange(deactivating ? 'inactive' : 'active');
            toast.success(`${name} ${deactivating ? 'deactivated' : 'reactivated'}`);
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </>
  );
}
