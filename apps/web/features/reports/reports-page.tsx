'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BarChart3, Download, Info, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ReportParams } from '@caretrail/api-client';
import { REPORT_INFO, REPORT_KEYS, type ReportCell, type ReportColumn, type ReportKey } from '@caretrail/shared-types';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, errorMessage } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RequirePermission } from '@/features/auth/require-session';
import { useSession } from '@/features/auth/session-store';
import { useCommunities, useFacilities } from '@/features/directory/use-directory';
import { useActiveOrganisation } from '@/features/org-context/active-organisation';
import { OrganisationPicker } from '@/features/org-context/organisation-picker';
import { formatDateTime } from '@/features/users/labels';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';

const ALL = 'all';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const nf = new Intl.NumberFormat('en-NG');

function formatCell(v: ReportCell, type: ReportColumn['type']): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return type === 'datetime' ? formatDateTime(v) : v;
  if (type === 'percent') return `${v}%`;
  if (type === 'days') return `${v} d`;
  return nf.format(v);
}

function ReportsContent() {
  const role = useSession((s) => s.user!.role);
  const isFacility = role === 'facility_admin' || role === 'facility_worker';
  const available = REPORT_KEYS.filter((k) => !isFacility || REPORT_INFO[k].facilityStaff);
  const { isPlatform, organisationId } = useActiveOrganisation();
  const facilities = useFacilities();
  const communities = useCommunities();
  const [report, setReport] = useState<ReportKey>(available[0]!);
  const [to, setTo] = useState(() => iso(new Date()));
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 89 * 86_400_000)));
  const [facilityId, setFacility] = useState(ALL);
  const [communityId, setCommunity] = useState(ALL);
  const [downloading, setDownloading] = useState(false);
  const needsOrg = isPlatform && !organisationId;
  const inOrg = <T extends { organisationId: string }>(list: T[] | undefined) => (list ?? []).filter((x) => !organisationId || x.organisationId === organisationId);

  const params: ReportParams = {
    report,
    from,
    to,
    ...(isPlatform && organisationId ? { organisationId } : {}),
    ...(facilityId !== ALL ? { facilityId } : {}),
    ...(communityId !== ALL ? { communityId } : {}),
  };
  const validRange = Boolean(from && to && from <= to);
  const query = useQuery({ queryKey: ['report', params], queryFn: () => api.reports.run(params), placeholderData: keepPreviousData, enabled: !needsOrg && validRange });
  const data = query.data;

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await api.reports.csv(params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `caretrail-${report}-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Programme figures for reviews and funders. Reports contain counts only, never patient details."
        actions={
          <>
            <OrganisationPicker />
            {!needsOrg && (
              <Button className="h-9" variant="outline" onClick={download} disabled={downloading || !validRange || !data}>
                {downloading ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />} Download CSV
              </Button>
            )}
          </>
        }
      />
      {needsOrg ? (
        <EmptyState icon={BarChart3} title="Choose an organisation" />
      ) : (
        <div className="grid gap-4">
          <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="grid gap-1.5 lg:col-span-2">
              <Label htmlFor="r-report">Report</Label>
              <Select value={report} onValueChange={(v) => setReport(v as ReportKey)}>
                <SelectTrigger id="r-report"><SelectValue /></SelectTrigger>
                <SelectContent>{available.map((k) => <SelectItem key={k} value={k}>{REPORT_INFO[k].title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="r-from">From</Label>
              <Input id="r-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="r-to">To</Label>
              <Input id="r-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
            {!isFacility && (
              <div className="grid gap-1.5">
                <Label htmlFor="r-com">Community</Label>
                <Select value={communityId} onValueChange={setCommunity}>
                  <SelectTrigger id="r-com"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All communities</SelectItem>
                    {inOrg(communities.data).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!isFacility && (report === 'referrals' || report === 'appointments' || report === 'monthly') && (
              <div className="grid gap-1.5">
                <Label htmlFor="r-fac">Facility</Label>
                <Select value={facilityId} onValueChange={setFacility}>
                  <SelectTrigger id="r-fac"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All facilities</SelectItem>
                    {inOrg(facilities.data).map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-5">{REPORT_INFO[report].description}{!validRange && <span className="ml-2 text-danger-700">Choose a start date on or before the end date.</span>}</p>
          </Card>

          <Card className="gap-0 overflow-hidden p-0">
            {query.isPending && validRange ? (
              <div className="grid gap-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : query.error ? (
              <ErrorState error={query.error} onRetry={() => query.refetch()} />
            ) : !data || data.rows.length === 0 ? (
              <EmptyState icon={BarChart3} title="Nothing in this period" description="Try a longer period or remove filters." />
            ) : (
              <div className={cn('overflow-x-auto', query.isFetching && 'opacity-60')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {data.columns.map((c) => (
                        <TableHead key={c.key} className={cn('whitespace-nowrap', c.type !== 'text' && 'text-right')}>
                          {c.help ? (
                            <Tooltip>
                              <TooltipTrigger className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-4">{c.label}<Info className="size-3.5" aria-hidden /></TooltipTrigger>
                              <TooltipContent className="max-w-xs">{c.help}</TooltipContent>
                            </Tooltip>
                          ) : c.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r, i) => (
                      <TableRow key={i}>
                        {data.columns.map((c) => <TableCell key={c.key} className={cn(c.type !== 'text' ? 'text-right tabular-nums' : 'font-medium')}>{formatCell(r[c.key] ?? null, c.type)}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                  {data.totals && (
                    <TableFooter>
                      <TableRow>
                        {data.columns.map((c) => <TableCell key={c.key} className={cn('font-semibold', c.type !== 'text' && 'text-right tabular-nums')}>{formatCell(data.totals![c.key] ?? null, c.type)}</TableCell>)}
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </div>
            )}
            {data && <p className="border-t px-4 py-2 text-xs text-muted-foreground">Generated {formatDateTime(data.generatedAt)} · {data.filters.from} to {data.filters.to}. Rates in totals are recalculated from the totals, not averaged.</p>}
          </Card>
        </div>
      )}
    </>
  );
}

export function ReportsPage() {
  return (
    <RequirePermission permission="analytics:read">
      <ReportsContent />
    </RequirePermission>
  );
}
