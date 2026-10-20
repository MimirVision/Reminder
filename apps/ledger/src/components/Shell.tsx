import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, CalendarDays, Home, ListChecks, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Plus, Repeat, Search, SearchCheck, Settings, X } from 'lucide-react';
import { isOpen } from '../lib/types';
import { useStore } from '../data/store';
import { Link, useRoute } from '../router';
import { Button, IconButton, Kbd } from '../ui/button';
import { cn } from '../ui/cn';
import { useUI } from './ui-state';

const NAV = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/tasks', label: 'My Tasks', icon: ListChecks },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/clients', label: 'Clients', icon: Building2 },
  { to: '/recurring', label: 'Recurring Work', icon: Repeat },
  { to: '/missing', label: 'Missing Tasks', icon: SearchCheck },
] as const;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

function Sidebar({ onNavigate, collapsed = false, onToggle }: { onNavigate?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  const { path } = useRoute();
  const { reviewCount, repo, snap, today, clientById } = useStore();
  const active = (to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));
  const overdue = snap.occurrences.filter((o) => isOpen(o.status) && o.dueDate < today).length;
  // Meetings still to come today (by end time), so the calendar shows when the day has appointments left.
  const nowHHMM = new Date().toTimeString().slice(0, 5);
  const meetingsLeft = snap.meetings.filter((m) => m.date === today && m.end > nowHHMM).length;
  const pinned = (snap.workspace.settings.pinnedClients ?? []).map((id) => clientById.get(id)).filter((c): c is NonNullable<typeof c> => !!c && c.status === 'active');
  const overdueBy = (id: string) => snap.occurrences.filter((o) => o.clientId === id && isOpen(o.status) && o.dueDate < today).length;
  const count = (n: number, tone: 'danger' | 'warn' | 'muted', label: string) => n > 0 && (
    <span aria-label={label} className={cn('num text-[11px] font-medium',
      tone === 'danger' ? 'text-[#ff8a7a]' : tone === 'warn' ? 'text-[#f2b45c]' : 'text-side-ink-3',
      collapsed && 'absolute -top-0.5 right-0.5 rounded-full bg-side px-1 text-[10px] leading-4')}>{n}</span>
  );
  const AVATAR = ['bg-[#2e5e4e] text-[#cff2e2]', 'bg-[#4a3c6e] text-[#e4dcff]', 'bg-[#6b4a2b] text-[#ffe5c7]', 'bg-[#29506e] text-[#d3ecff]', 'bg-[#6b2f3f] text-[#ffd9e1]'];
  const avatarFor = (id: string) => AVATAR[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];
  const item = (to: string, label: string, Icon: typeof Home | null, badge?: ReactNode, extra?: string) => (
    <Link
      key={to}
      to={to}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active(to) ? 'page' : undefined}
      className={cn(
        'group relative flex h-[34px] items-center gap-2.5 rounded-lg text-[13px] transition-colors focus-visible:outline-[#8fabff]',
        collapsed ? 'justify-center px-0' : 'px-2.5',
        active(to) ? 'bg-side-active font-medium text-side-ink' : 'text-side-ink-2 hover:bg-side-hover hover:text-side-ink', extra,
      )}
    >
      {Icon ? <Icon className={cn('size-4 shrink-0', active(to) ? 'text-[#8fabff]' : 'text-side-ink-3 group-hover:text-side-ink-2')} strokeWidth={1.9} />
        : <span className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold', avatarFor(to))} aria-hidden>{label.slice(0, 1)}</span>}
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {badge}
    </Link>
  );
  return (
    <nav aria-label="Main" className={cn('flex h-full flex-col border-r border-white/[0.06] bg-side pt-[18px] pb-3 text-side-ink-2 transition-[width] duration-200', collapsed ? 'w-[60px] px-2' : 'w-[240px] px-3')}>
      <div className={cn('mb-5 flex items-center gap-2.5', collapsed ? 'justify-center' : 'px-1.5')}>
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#f5f4f0] text-[14px] font-bold tracking-tight text-[#18191d]" aria-hidden>L</div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-[14px] leading-tight font-semibold tracking-[-0.01em] text-side-ink">Ledger</div>
            <div className="truncate text-[11.5px] leading-tight text-side-ink-3">{snap.workspace.name || 'Workspace'}</div>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {NAV.map((n) => item(n.to, n.label, n.icon,
          n.to === '/tasks' ? count(overdue, 'danger', `${overdue} overdue`)
            : n.to === '/missing' ? count(reviewCount, 'warn', `${reviewCount} to review`)
            : n.to === '/calendar' ? count(meetingsLeft, 'muted', `${meetingsLeft} meeting${meetingsLeft === 1 ? '' : 's'} left today`) : undefined))}
      </div>
      {pinned.length > 0 && (
        <div className="mt-6 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {!collapsed && <div className="px-2.5 pb-1.5 text-[11px] font-medium tracking-[0.06em] text-side-ink-3 uppercase">Pinned clients</div>}
          {pinned.map((c) => item(`/clients/${c.id}`, c.name, null, count(overdueBy(c.id), 'danger', `${overdueBy(c.id)} overdue`)))}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-2 pt-3">
        {repo.mode === 'demo' && !collapsed && (
          <div className="rounded-lg border border-dashed border-white/15 px-2.5 py-2 text-[11.5px] leading-snug text-side-ink-3">
            <span className="font-medium text-side-ink-2">Demo mode.</span> Fictional data, kept in this browser only.
          </div>
        )}
        {item('/settings', 'Settings', Settings)}
        {onToggle && (
          <button onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn('flex h-8 items-center gap-2.5 rounded-lg text-[12.5px] text-side-ink-3 hover:bg-side-hover hover:text-side-ink', collapsed ? 'justify-center' : 'px-2.5')}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
          </button>
        )}
      </div>
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('ledger-sidebar') === 'collapsed'; } catch { return false; } });
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('ledger-sidebar', c ? 'open' : 'collapsed'); } catch { /* ignore */ } return !c; });
  const { path } = useRoute();
  useEffect(() => setDrawer(false), [path]);
  return (
    <div className="flex min-h-full">
      <a href="#main" className="sr-only z-50 rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>
      <div className="sticky top-0 hidden h-screen shrink-0 lg:block"><Sidebar collapsed={collapsed} onToggle={toggle} /></div>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-[rgb(20_20_28/0.25)]" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 animate-slide-in shadow-pop">
            <Sidebar onNavigate={() => setDrawer(false)} />
            <IconButton label="Close menu" className="absolute top-3 right-2" onClick={() => setDrawer(false)}><X /></IconButton>
          </div>
        </div>
      )}
      <DrawerContext.Provider value={() => setDrawer(true)}>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </DrawerContext.Provider>
    </div>
  );
}

const DrawerContext = createContext<() => void>(() => {});

/**
 * A page: a slim sticky bar (breadcrumb, search, New task) and the content, which opens with a large title row.
 * Pages with their own hero (Home, a client) pass `hideTitle` and render their own h1.
 */
export function Page({ title, crumb, docTitle, subtitle, actions, barActions, titleExtra, hideTitle, children }: {
  title: string; crumb?: ReactNode;
  /** Page-level controls in the top bar, before search. */
  barActions?: ReactNode; docTitle?: string; subtitle?: ReactNode; actions?: ReactNode; titleExtra?: ReactNode; hideTitle?: boolean; children: ReactNode;
}) {
  const openDrawer = useContext(DrawerContext);
  const ui = useUI();
  // The tab shows how much is overdue, so a pinned tab says when something needs attention.
  const { snap, today } = useStore();
  const overdue = useMemo(() => snap.occurrences.filter((o) => isOpen(o.status) && o.dueDate < today).length, [snap.occurrences, today]);
  useEffect(() => { document.title = `${overdue ? `(${overdue}) ` : ''}${docTitle ?? title} · Ledger`; }, [title, docTitle, overdue]);
  return (
    <>
      <header className="sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md md:px-8">
        <IconButton label="Open menu" className="-ml-1 lg:hidden" onClick={openDrawer}><MenuIcon /></IconButton>
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1 truncate text-[13px] text-ink-3">
          {crumb ?? <span className="font-medium text-ink-2">{title}</span>}
        </nav>
        {barActions}
        <button
          onClick={() => ui.setPalette(true)}
          className="hidden h-[34px] w-60 items-center gap-2 rounded-[9px] border border-line bg-surface px-3 text-[12.5px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2 md:flex"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd>{`${MOD} K`}</Kbd>
        </button>
        <IconButton label="Search" className="md:hidden" onClick={() => ui.setPalette(true)}><Search /></IconButton>
        <Button variant="primary" onClick={() => ui.openNewTask()} aria-keyshortcuts="n">
          <Plus /> <span className="hidden sm:inline">New task</span>
        </Button>
      </header>
      <main id="main" className={cn('mx-auto w-full flex-1 px-4 pt-7 pb-10 md:px-8', 'max-w-[1400px]')}>
        {!hideTitle && (
          <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
            <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
            {titleExtra}
            {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
          </div>
        )}
        {subtitle && <div className="mb-5">{subtitle}</div>}
        {children}
      </main>
    </>
  );
}
