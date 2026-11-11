'use client';

import { ChevronsLeft, ChevronsRight, LogOut, Menu, MonitorSmartphone, UserCircle2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useState, type ReactNode } from 'react';
import { ROLE_LABELS } from '@caretrail/shared-types';
import { Logo } from '@/components/brand/logo';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/features/auth/session-store';
import { cn } from '@/lib/utils';
import { signOut } from '@/services/api';
import { SEGMENT_LABELS, visibleNavItems, type NavItem } from './navigation';

const COLLAPSE_KEY = 'caretrail.sidebar.collapsed';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

const GROUP_LABELS: Record<NavItem['group'], string | null> = { main: null, administration: 'Administration', account: 'Account' };

function NavLinks({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed: boolean; onNavigate?: () => void }) {
  const groups = (['main', 'administration', 'account'] as const)
    .map((g) => ({ g, items: items.filter((i) => i.group === g) }))
    .filter((x) => x.items.length > 0);
  return (
    <nav aria-label="Main" className="grid gap-4">
      {groups.map(({ g, items: groupItems }) => (
        <div key={g} className="grid gap-1">
          {GROUP_LABELS[g] &&
            (collapsed ? (
              <hr className="mx-2 mb-1 border-border" />
            ) : (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{GROUP_LABELS[g]}</p>
            ))}
          <NavGroup items={groupItems} collapsed={collapsed} {...(onNavigate ? { onNavigate } : {})} />
        </div>
      ))}
    </nav>
  );
}

function NavGroup({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const link = (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
              active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-ink-muted hover:bg-muted hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            <item.icon className={cn('size-5 shrink-0', active && 'text-brand-600')} aria-hidden />
            {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
          </Link>
        );
        return collapsed ? (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ) : (
          link
        );
      })}
    </>
  );
}

function Breadcrumbs() {
  const segments = usePathname().split('/').filter(Boolean);
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((seg, i) => {
          const href = `/${segments.slice(0, i + 1).join('/')}`;
          const label = SEGMENT_LABELS[seg] ?? 'Details';
          const last = i === segments.length - 1;
          return (
            <Fragment key={href}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {last ? <BreadcrumbPage>{label}</BreadcrumbPage> : <BreadcrumbLink asChild><Link href={href}>{label}</Link></BreadcrumbLink>}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function UserMenu() {
  const user = useSession((s) => s.user)!;
  const router = useRouter();
  const doSignOut = async (all: boolean) => {
    await signOut(all);
    router.replace('/login');
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2" aria-label="Account menu">
          <Avatar className="size-8">
            <AvatarFallback className="bg-brand-100 text-xs font-semibold text-brand-800">{initials(user.fullName)}</AvatarFallback>
          </Avatar>
          <span className="hidden text-start sm:block">
            <span className="block text-sm font-medium leading-tight">{user.fullName}</span>
            <span className="block text-xs leading-tight text-muted-foreground">{ROLE_LABELS[user.role]}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{user.fullName}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile"><UserCircle2 aria-hidden /> My profile</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void doSignOut(false)}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void doSignOut(true)}>
          <MonitorSmartphone aria-hidden /> Sign out of all devices
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const user = useSession((s) => s.user)!;
  const items = visibleNavItems(user.role, user.permissions);
  // UI preference only (not sensitive), so localStorage is appropriate. The shell mounts only
  // after the session is restored on the client, so reading storage here cannot cause a
  // hydration mismatch.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !c;
    });

  return (
    <div className="flex min-h-full flex-1">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside
        className={cn(
          'sticky top-0 hidden h-svh shrink-0 flex-col border-e bg-sidebar transition-[width] duration-200 md:flex',
          collapsed ? 'w-[4.5rem]' : 'w-60',
        )}
      >
        <div className={cn('flex h-16 items-center border-b px-4', collapsed && 'justify-center px-0')}>
          <Link href={items[0]?.href ?? '/profile'} aria-label="CARETRAIL home">
            <Logo compact={collapsed} />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks items={items} collapsed={collapsed} />
        </div>
        <div className="border-t p-3">
          <Button variant="ghost" className={cn('h-10 w-full justify-start gap-3 text-ink-muted', collapsed && 'justify-center')} onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight className="size-5" /> : <><ChevronsLeft className="size-5" /> Collapse</>}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-lg" className="md:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <div className="flex h-16 items-center border-b px-4"><Logo /></div>
              <div className="p-3">
                <NavLinks items={items} collapsed={false} onNavigate={() => setMobileOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1"><Breadcrumbs /></div>
          <UserMenu />
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
