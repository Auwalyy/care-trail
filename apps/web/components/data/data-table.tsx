'use client';

import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PaginationMeta } from '@caretrail/shared-types';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

/** Table with built-in loading, error, empty and pagination states. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isPending,
  isFetching,
  error,
  onRetry,
  empty,
  meta,
  onPageChange,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isPending: boolean;
  isFetching?: boolean;
  error: unknown;
  onRetry?: () => void;
  empty: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode };
  meta?: PaginationMeta | undefined;
  onPageChange?: (page: number) => void;
}) {
  if (isPending) return <TableSkeleton cols={Math.min(columns.length, 5)} />;
  if (error) return <ErrorState error={error} {...(onRetry ? { onRetry } : {})} />;
  if (!rows || rows.length === 0) return <EmptyState {...empty} />;

  return (
    <>
      <div className={cn('overflow-x-auto', isFetching && 'opacity-70 transition-opacity')}>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {columns.map((c, i) => (
                <TableHead key={c.key} className={cn(i === 0 && 'ps-4', i === columns.length - 1 && 'pe-4', c.className)}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((c, i) => (
                  <TableCell key={c.key} className={cn(i === 0 && 'ps-4', i === columns.length - 1 && 'pe-4', c.className)}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {meta && onPageChange && meta.total > meta.pageSize && (
        <div className="flex items-center justify-between gap-4 border-t px-4 py-3 text-sm">
          <p className="text-muted-foreground">
            {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
              <ChevronLeft aria-hidden /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPageChange(meta.page + 1)}>
              Next <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
