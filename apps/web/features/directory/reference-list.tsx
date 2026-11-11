'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ApiList, RecordStatus } from '@caretrail/shared-types';
import type { DirectoryParams } from '@caretrail/api-client';
import { DataTable, type Column } from '@/components/data/data-table';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import type { LucideIcon } from 'lucide-react';

const ALL = '__all__';

/** Search + status filter + paged table for organisation-scoped reference data. */
export function ReferenceList<T extends { id: string }>({
  resource,
  fetcher,
  organisationId,
  columns,
  searchLabel,
  empty,
}: {
  resource: string;
  fetcher: (params: DirectoryParams) => Promise<ApiList<T>>;
  organisationId?: string | null | undefined;
  columns: Column<T>[];
  searchLabel: string;
  empty: { icon: LucideIcon; title: string; description?: string; action?: ReactNode };
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<RecordStatus | typeof ALL>(ALL);
  const q = useDebouncedValue(search.trim());
  const params: DirectoryParams = {
    page,
    pageSize: 25,
    ...(q ? { q } : {}),
    ...(status !== ALL ? { status } : {}),
    ...(organisationId ? { organisationId } : {}),
  };
  const query = useQuery({ queryKey: [resource, params], queryFn: () => fetcher(params), placeholderData: keepPreviousData });
  const filtered = Boolean(q) || status !== ALL;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={searchLabel} aria-label={searchLabel} className="h-9 ps-9" />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as RecordStatus | typeof ALL); setPage(1); }}>
          <SelectTrigger className="h-9 sm:w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(r) => r.id}
        isPending={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        empty={filtered ? { icon: empty.icon, title: 'Nothing matches these filters', description: 'Try a different search or status.' } : empty}
        meta={query.data?.meta}
        onPageChange={setPage}
      />
    </Card>
  );
}
