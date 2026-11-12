'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import type { InboxItemDto, NotificationLink } from '@caretrail/shared-types';
import { DataTable, type Column } from '@/components/data/data-table';
import { PageHeader } from '@/components/layout/page-header';
import { errorMessage } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime } from '@/features/users/labels';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';

const HREF: Record<NotificationLink['type'], (id: string) => string> = {
  follow_up: (id) => `/follow-ups/${id}`,
  appointment: () => '/appointments',
  referral: (id) => `/referrals/${id}`,
};

/** The signed-in user's in-app messages (new follow-up tasks, escalations). */
export function InboxPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 25, ...(filter === 'unread' ? { unread: 'true' as const } : {}) };
  const query = useQuery({ queryKey: ['inbox', params], queryFn: () => api.notifications.inbox(params), placeholderData: keepPreviousData });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['inbox'] }), qc.invalidateQueries({ queryKey: ['inbox-count'] })]);

  const open = async (m: InboxItemDto) => {
    if (!m.readAt) await api.notifications.markRead(m.id).then(refresh).catch(() => undefined);
  };

  const columns: Column<InboxItemDto>[] = [
    {
      key: 'text',
      header: 'Message',
      cell: (m) => {
        const text = <span className={cn(!m.readAt && 'font-semibold')}>{!m.readAt && <span className="mr-2 inline-block size-2 rounded-full bg-brand-600 align-middle" aria-label="Unread" />}{m.text}</span>;
        return m.link ? <Link href={HREF[m.link.type](m.link.id)} className="hover:underline" onClick={() => void open(m)}>{text}</Link> : text;
      },
    },
    { key: 'at', header: 'Received', className: 'w-48 whitespace-nowrap', cell: (m) => <span className="text-sm text-muted-foreground">{formatDateTime(m.createdAt)}</span> },
    {
      key: 'read',
      header: <span className="sr-only">Mark read</span>,
      className: 'w-32',
      cell: (m) => !m.readAt && <Button variant="ghost" size="sm" onClick={() => void open(m)}>Mark read</Button>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Messages"
        description="New follow-up tasks and escalations addressed to you."
        actions={
          <Button
            variant="outline"
            className="h-9"
            onClick={() =>
              api.notifications
                .markAllRead()
                .then((r) => {
                  toast.success(r.updated ? `${r.updated} marked as read` : 'Nothing unread');
                  return refresh();
                })
                .catch((err: unknown) => toast.error(errorMessage(err)))
            }
          >
            <CheckCheck aria-hidden /> Mark all read
          </Button>
        }
      />
      <Card className="gap-0 overflow-hidden p-0">
        <div className="border-b p-4">
          <Tabs value={filter} onValueChange={(v) => { setFilter(v as typeof filter); setPage(1); }}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unread">Unread</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <DataTable
          columns={columns}
          rows={query.data?.data}
          rowKey={(m) => m.id}
          isPending={query.isPending}
          isFetching={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          empty={{ icon: Bell, title: filter === 'unread' ? 'Nothing unread' : 'No messages yet' }}
          meta={query.data?.meta}
          onPageChange={setPage}
        />
      </Card>
    </>
  );
}
