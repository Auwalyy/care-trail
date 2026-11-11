'use client';

import { Check, Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import type { IssuedLink } from '@caretrail/shared-types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatDateTime } from './labels';

export interface IssuedLinkInfo {
  link: IssuedLink;
  userName: string;
  kind: 'activation' | 'reset';
}

/** Shows a one-time activation/reset link so the administrator can hand it to the user. */
export function IssuedLinkDialog({ info, onClose }: { info: IssuedLinkInfo | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!info) return;
    await navigator.clipboard.writeText(info.link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={info !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-brand-600" aria-hidden />
            {info?.kind === 'activation' ? 'Activation link' : 'Password reset link'}
          </DialogTitle>
          <DialogDescription>
            Give this link to <strong>{info?.userName}</strong> so they can set their own password. It expires{' '}
            {info ? formatDateTime(info.link.expiresAt) : ''} and works once.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={info?.link.url ?? ''} aria-label="Link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Button type="button" variant="outline" onClick={copy} className="h-9 shrink-0">
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <Alert>
          <AlertDescription>
            Anyone with this link can set the password. Share it only with this person, in person or through a channel you trust.
            It will not be shown again — issue a new one if it is lost.
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
